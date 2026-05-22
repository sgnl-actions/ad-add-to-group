/**
 * Active Directory Add Member to Group Action
 *
 * Adds a user or group ("member") to a group in on-premise Active Directory
 * using LDAP/LDAPS. If ttlSeconds is provided, the membership is added with
 * an AD temporary-membership TTL (requires the Privileged Access Management
 * Feature to be enabled in the forest). If the member is already in the
 * group, returns success with added=false when no TTL is requested; throws
 * an explicit error when ttlSeconds is set, since AD will not overlay a TTL
 * onto an existing non-temporary membership.
 */

import { Client, Change, Attribute } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/**
 * Escape special characters in LDAP filter values to prevent injection.
 */
function escapeLDAPFilter(str) {
  return str.replace(/[\\*()\0]/g, (char) => '\\' + char.charCodeAt(0).toString(16).padStart(2, '0'));
}

/**
 * Find a member's Distinguished Name by sAMAccountName. Matches both users
 * and groups since both expose sAMAccountName and it is unique per domain.
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
 * Add a member to a group. When ttlSeconds is provided, the member value
 * uses AD's temporary-membership syntax: `<TTL=N>,DN`.
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
  invoke: async (params, context) => {
    console.log('Starting Active Directory add member to group operation');

    const { baseDN, samAccountName, groupDN, ttlSeconds, dry_run = false } = params;

    if (!baseDN) {
      throw new Error('baseDN is required');
    }
    if (!samAccountName) {
      throw new Error('samAccountName is required');
    }
    if (!groupDN) {
      throw new Error('groupDN is required');
    }

    // Validate ttlSeconds when provided: positive integer
    let ttl;
    if (ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds !== '') {
      ttl = Number(ttlSeconds);
      if (!Number.isInteger(ttl) || ttl < 1) {
        throw new Error('ttlSeconds must be a positive integer (seconds)');
      }
    }

    const ttlSuffix = ttl ? ` with TTL ${ttl}s` : '';
    console.log(`Planning to add member "${samAccountName}" to group "${groupDN}"${ttlSuffix}`);

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

    const address = getBaseURL(params, context);
    const bindDN = context.secrets.BASIC_USERNAME;
    const bindPassword = context.secrets.BASIC_PASSWORD;

    if (!bindDN || !bindPassword) {
      throw new Error('Missing LDAP bind credentials. Provide BASIC_USERNAME and BASIC_PASSWORD in secrets.');
    }

    const clientOptions = {
      url: address,
      timeout: 10000,
      connectTimeout: 10000
    };

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

      const memberDN = await findMemberDN(client, baseDN, samAccountName);

      console.log(`Adding member to group: ${groupDN}${ttlSuffix}`);
      await addMemberToGroup(memberDN, groupDN, client, ttl);

      console.log(`Successfully added member "${memberDN}" to group "${groupDN}"${ttlSuffix}`);
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
      // LDAP error code 68: ENTRY_ALREADY_EXISTS — member is already in the group
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

  error: async (params, _context) => {
    const { error, samAccountName, groupDN } = params;
    console.error(`Error handler invoked for adding "${samAccountName}" to "${groupDN}": ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check BASIC_USERNAME and BASIC_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused')) {
      console.error('Connection error - may be transient, framework will retry');
      throw error;
    }

    if (errorMessage.includes('member not found')) {
      console.error('Member not found - check samAccountName and baseDN');
      throw new Error(`Member not found: ${error.message}`);
    }

    if (errorMessage.includes('multiple members found')) {
      console.error('Multiple members found - sAMAccountName should be unique');
      throw new Error(`Multiple members found: ${error.message}`);
    }

    if (errorMessage.includes('not found') ||
        errorMessage.includes('no such object')) {
      console.error('Resource not found - check groupDN');
      throw new Error(`Resource not found: ${error.message}`);
    }

    if (errorMessage.includes('insufficient access') ||
        errorMessage.includes('permission denied')) {
      console.error('Insufficient permissions - check service account privileges');
      throw new Error(`Insufficient LDAP permissions: ${error.message}`);
    }

    console.error('Unknown error occurred, allowing framework to retry');
    throw error;
  },

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
