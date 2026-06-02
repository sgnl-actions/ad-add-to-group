/**
 * Active Directory Add Member to Group Action
 *
 * Adds a user or group ("member") to a group in on-premise Active Directory
 * using LDAP/LDAPS. The member is resolved by sAMAccountName, which is unique
 * per domain and matches either a user or a group.
 *
 * If `ttlSeconds` is provided, the membership is added with AD's temporary
 * group membership syntax (`<TTL=N>,DN`). This requires the Privileged Access
 * Management Feature to be enabled in the forest (Forest Functional Level
 * Windows Server 2016+); AD will then automatically remove the membership
 * when the TTL elapses.
 *
 * If the member is already in the group:
 *   - without TTL: returns success with `added: false` (idempotent)
 *   - with TTL: throws an explicit error, because AD will not overlay a TTL
 *     onto an existing non-temporary membership
 */

import { Client, Change, Attribute } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/**
 * Escape special characters in LDAP filter values to prevent injection.
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for use in LDAP filters
 */
function escapeLDAPFilter(str) {
  return str.replace(/[\\*()\0]/g, (char) => '\\' + char.charCodeAt(0).toString(16).padStart(2, '0'));
}

/**
 * Find a member's Distinguished Name by searching for their sAMAccountName.
 *
 * The objectClass filter matches both users and groups since sAMAccountName
 * is unique per domain and may resolve to either.
 *
 * @param {Client} client - Bound ldapts Client instance
 * @param {string} baseDN - Base DN to search from
 * @param {string} samAccountName - sAMAccountName of the user or group
 * @returns {Promise<string>} The member's Distinguished Name
 * @throws {Error} If no member is found or multiple members are found
 */
async function findMemberDN(client, baseDN, samAccountName) {
  console.log(`Searching for member with sAMAccountName: ${samAccountName}`);

  const escapedSamAccountName = escapeLDAPFilter(samAccountName);
  const { searchEntries } = await client.search(baseDN, {
    scope: 'sub',
    filter: `(&(|(objectClass=user)(objectClass=group))(sAMAccountName=${escapedSamAccountName}))`,
    attributes: ['distinguishedName']
  });

  if (!searchEntries || searchEntries.length === 0) {
    throw new Error(`Member not found with sAMAccountName: ${samAccountName}`);
  }

  if (searchEntries.length > 1) {
    throw new Error(`Multiple members found with sAMAccountName: ${samAccountName}. Expected exactly one.`);
  }

  const memberDN = searchEntries[0].dn;
  console.log(`Found member DN: ${memberDN}`);
  return memberDN;
}

/**
 * Safely disconnect from LDAP server.
 * Errors during unbind are logged but not thrown to avoid masking original errors.
 *
 * @param {Client} client - The ldapts client
 */
async function safeUnbind(client) {
  if (!client) {
    return;
  }
  try {
    await client.unbind();
  } catch (unbindError) {
    console.warn(`Warning: Error during LDAP unbind: ${unbindError.message}`);
  }
}

/**
 * Add a member to a group in Active Directory by modifying the group's
 * member attribute.
 *
 * When `ttlSeconds` is provided, the attribute value uses AD's temporary-
 * membership syntax: `<TTL=N>,DN`. AD automatically removes the membership
 * when the TTL elapses (requires the PAM feature to be enabled).
 *
 * @param {string} memberDN - Distinguished Name of the member to add
 * @param {string} groupDN - Distinguished Name of the group
 * @param {Client} client - Bound ldapts Client instance
 * @param {number} [ttlSeconds] - Optional TTL in seconds for temporary membership
 * @returns {Promise<{success: boolean}>}
 */
async function addMemberToGroup(memberDN, groupDN, client, ttlSeconds) {
  const memberValue = ttlSeconds ? `<TTL=${ttlSeconds}>,${memberDN}` : memberDN;
  await client.modify(groupDN, [
    new Change({
      operation: 'add',
      modification: new Attribute({
        type: 'member',
        values: [memberValue]
      })
    })
  ]);

  return { success: true };
}

export default {
  /**
   * Main execution handler - adds a member (user or group) to a group in
   * Active Directory.
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.baseDN - Base DN to search for the member
   * @param {string} params.samAccountName - sAMAccountName of the user or group to add
   * @param {string} params.groupDN - Distinguished Name of the target group
   * @param {number} [params.ttlSeconds] - Optional TTL in seconds for temporary group membership (requires AD PAM feature)
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, memberDN, groupDN, and added flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory add member to group operation');

    const { baseDN, samAccountName, groupDN, ttlSeconds, dry_run = false } = params;

    // Validate required parameters
    if (!baseDN) {
      throw new Error('baseDN is required');
    }
    if (!samAccountName) {
      throw new Error('samAccountName is required');
    }
    if (!groupDN) {
      throw new Error('groupDN is required');
    }

    // Validate optional ttlSeconds: when provided, must be a positive integer.
    // We reject invalid values up front so we don't issue any LDAP I/O for input
    // that AD would either reject or silently coerce.
    let ttl;
    if (ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds !== '') {
      ttl = Number(ttlSeconds);
      if (!Number.isInteger(ttl) || ttl < 1) {
        throw new Error('ttlSeconds must be a positive integer (seconds)');
      }
    }

    const ttlSuffix = ttl ? ` with TTL ${ttl}s` : '';
    console.log(`Planning to add member "${samAccountName}" to group "${groupDN}"${ttlSuffix}`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      return {
        status: 'dry_run_completed',
        baseDN,
        samAccountName,
        memberDN: null,
        userDN: null,
        groupDN,
        added: false,
        ttlSeconds: ttl ?? null
      };
    }

    // Get LDAP connection details
    const address = getBaseURL(params, context);
    const bindDN = context.secrets.BASIC_USERNAME;
    const bindPassword = context.secrets.BASIC_PASSWORD;

    // Validate required secrets
    if (!bindDN || !bindPassword) {
      throw new Error('Missing LDAP bind credentials. Provide BASIC_USERNAME and BASIC_PASSWORD in secrets.');
    }

    // Configure LDAP client with timeouts
    const clientOptions = {
      url: address,
      timeout: 10000,
      connectTimeout: 10000
    };

    // Configure TLS options for secure connections
    // Only apply TLS options to ldaps:// (encrypted) connections
    // For ldap:// (plain text) connections, TLS options cause connection failures
    if (address.startsWith('ldaps://')) {
      clientOptions.tlsOptions = {
        rejectUnauthorized: context.environment?.TLS_SKIP_VERIFY !== 'true'
      };
    }

    const client = new Client(clientOptions);

    try {
      console.log(`Connecting to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);
      console.log('Successfully authenticated to LDAP server');

      // Lookup member DN by sAMAccountName (matches users and groups)
      const memberDN = await findMemberDN(client, baseDN, samAccountName);

      console.log(`Adding member to group: ${groupDN}${ttlSuffix}`);
      await addMemberToGroup(memberDN, groupDN, client, ttl);

      console.log(`Successfully added member "${memberDN}" to group "${groupDN}"${ttlSuffix}`);
      // `userDN` is kept as a same-value alias of `memberDN` for backward
      // compatibility with existing consumers.
      return {
        status: 'success',
        memberDN,
        userDN: memberDN,
        groupDN,
        added: true,
        address,
        ttlSeconds: ttl ?? null
      };
    } catch (error) {
      // LDAP error code 68: ENTRY_ALREADY_EXISTS - member is already in the group
      if (error.code === 68) {
        // When a TTL was requested, AD will not overlay a TTL onto an existing
        // non-temporary membership. Surface this explicitly rather than silently
        // succeeding without the requested TTL.
        if (ttl) {
          throw new Error(
            'Member is already in the group; TTL cannot be applied to an existing membership. '
            + 'Remove the member first, then retry with ttlSeconds.',
            { cause: error }
          );
        }

        // No TTL was requested: treat already-a-member as idempotent success.
        // Re-resolve the member DN for the response since we did not capture it
        // on the path that threw error 68.
        let memberDN = 'unknown';
        try {
          memberDN = await findMemberDN(client, baseDN, samAccountName);
        } catch (lookupError) {
          console.warn(`Warning: Could not retrieve member DN for response: ${lookupError.message}`);
        }
        console.log(`Member "${memberDN}" is already a member of group "${groupDN}"`);
        return {
          status: 'success',
          memberDN,
          userDN: memberDN,
          groupDN,
          added: false,
          message: 'Member is already a member of the group',
          address
        };
      }

      console.error(`Failed to add member to group: ${error.message}`);
      throw error;
    } finally {
      await safeUnbind(client);
    }
  },

  /**
   * Error recovery handler - classifies errors and determines retry behavior.
   *
   * @param {Object} params - Original params plus error information
   * @param {Error} params.error - The error that occurred
   * @param {string} params.baseDN - The base DN being searched
   * @param {string} params.samAccountName - The sAMAccountName being looked up
   * @param {string} params.groupDN - The group DN being modified
   * @param {Object} _context - Execution context (unused)
   * @throws {Error} Re-throws with appropriate classification
   */
  error: async (params, _context) => {
    const { error, samAccountName, groupDN } = params;
    console.error(`Error handler invoked for adding "${samAccountName}" to "${groupDN}": ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    // Authentication errors (fatal - don't retry)
    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check BASIC_USERNAME and BASIC_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    // Connection errors (retryable - framework will retry)
    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused')) {
      console.error('Connection error - may be transient, framework will retry');
      throw error;
    }

    // Member not found (fatal - don't retry)
    if (errorMessage.includes('member not found')) {
      console.error('Member not found - check samAccountName and baseDN');
      throw new Error(`Member not found: ${error.message}`);
    }

    // Multiple members found (fatal - don't retry)
    if (errorMessage.includes('multiple members found')) {
      console.error('Multiple members found - sAMAccountName should be unique');
      throw new Error(`Multiple members found: ${error.message}`);
    }

    // Not found (fatal - don't retry)
    if (errorMessage.includes('not found') ||
        errorMessage.includes('no such object')) {
      console.error('Resource not found - check groupDN');
      throw new Error(`Resource not found: ${error.message}`);
    }

    // Insufficient permissions (fatal - don't retry)
    if (errorMessage.includes('insufficient access') ||
        errorMessage.includes('permission denied')) {
      console.error('Insufficient permissions - check service account privileges');
      throw new Error(`Insufficient LDAP permissions: ${error.message}`);
    }

    // Unknown error - re-throw for framework retry
    console.error('Unknown error occurred, allowing framework to retry');
    throw error;
  },

  /**
   * Graceful shutdown handler - called when the job is halted.
   *
   * @param {Object} params - Original params plus halt reason
   * @param {string} params.reason - The reason for the halt
   * @param {string} [params.baseDN] - The base DN being searched
   * @param {string} [params.samAccountName] - The sAMAccountName being looked up
   * @param {string} [params.groupDN] - The group DN being modified
   * @param {Object} _context - Execution context (unused)
   * @returns {Object} Cleanup results with halted status
   */
  halt: async (params, _context) => {
    const { reason, baseDN, samAccountName, groupDN } = params;
    console.log(`Active Directory add member to group operation halted: ${reason}`);

    return {
      status: 'halted',
      baseDN: baseDN || 'unknown',
      samAccountName: samAccountName || 'unknown',
      groupDN: groupDN || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};
