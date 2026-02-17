// SGNL Job Script - Auto-generated bundle
'use strict';

var ldapts = require('ldapts');

/**
 * SGNL Actions - Authentication Utilities
 *
 * Shared authentication utilities for SGNL actions.
 * Supports: Bearer Token, Basic Auth, OAuth2 Client Credentials, OAuth2 Authorization Code
 */


/**
 * Get the base URL/address for API calls
 * @param {Object} params - Request parameters
 * @param {string} [params.address] - Address from params
 * @param {Object} context - Execution context
 * @returns {string} Base URL
 */
function getBaseURL(params, context) {
  const env = context.environment || {};
  const address = params?.address || env.ADDRESS;

  if (!address) {
    throw new Error('No URL specified. Provide address parameter or ADDRESS environment variable');
  }

  // Remove trailing slash if present
  return address.endsWith('/') ? address.slice(0, -1) : address;
}

/**
 * Active Directory Add User to Group Action
 *
 * Adds a user to a group in on-premise Active Directory using LDAP/LDAPS.
 * If the user is already a member, returns success with added=false.
 */


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
 * Find a user's Distinguished Name by searching for their sAMAccountName.
 *
 * @param {Client} client - Bound ldapts Client instance
 * @param {string} baseDN - Base DN to search from
 * @param {string} samAccountName - User's sAMAccountName
 * @returns {Promise<string>} The user's Distinguished Name
 * @throws {Error} If user not found or multiple users found
 */
async function findUserDN(client, baseDN, samAccountName) {
  console.log(`Searching for user with sAMAccountName: ${samAccountName}`);

  const escapedSamAccountName = escapeLDAPFilter(samAccountName);
  const { searchEntries } = await client.search(baseDN, {
    scope: 'sub',
    filter: `(&(objectClass=user)(sAMAccountName=${escapedSamAccountName}))`,
    attributes: ['distinguishedName']
  });

  if (!searchEntries || searchEntries.length === 0) {
    throw new Error(`User not found with sAMAccountName: ${samAccountName}`);
  }

  if (searchEntries.length > 1) {
    throw new Error(`Multiple users found with sAMAccountName: ${samAccountName}. Expected exactly one.`);
  }

  const userDN = searchEntries[0].dn;
  console.log(`Found user DN: ${userDN}`);
  return userDN;
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
 * Add a user to a group in Active Directory by modifying the group's member attribute.
 *
 * @param {string} userDN - Distinguished Name of the user to add
 * @param {string} groupDN - Distinguished Name of the group
 * @param {Client} client - Bound ldapts Client instance
 * @returns {Promise<{success: boolean}>}
 */
async function addUserToGroup(userDN, groupDN, client) {
  await client.modify(groupDN, [
    new ldapts.Change({
      operation: 'add',
      modification: new ldapts.Attribute({
        type: 'member',
        values: [userDN]
      })
    })
  ]);

  return { success: true };
}

var script = {
  /**
   * Main execution handler - adds a user to a group in Active Directory.
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.baseDN - Base DN to search for the user
   * @param {string} params.samAccountName - User's sAMAccountName to lookup
   * @param {string} params.groupDN - Distinguished Name of the group
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, userDN, groupDN, and added flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory add user to group operation');

    const { baseDN, samAccountName, groupDN, dry_run = false } = params;

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

    console.log(`Planning to add user "${samAccountName}" to group "${groupDN}"`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      return {
        status: 'dry_run_completed',
        baseDN,
        samAccountName,
        userDN: null,
        groupDN,
        added: false
      };
    }

    // Get LDAP connection details
    const address = getBaseURL(params, context);
    const bindDN = context.secrets.LDAP_BIND_DN;
    const bindPassword = context.secrets.LDAP_BIND_PASSWORD;

    // Validate required secrets
    if (!bindDN || !bindPassword) {
      throw new Error('Missing LDAP bind credentials. Provide LDAP_BIND_DN and LDAP_BIND_PASSWORD in secrets.');
    }

    // Configure LDAP client with timeouts
    const clientOptions = {
      url: address,
      timeout: 10000,
      connectTimeout: 10000
    };

    // Configure TLS options for secure connections
    if (address.startsWith('ldaps://') || context.environment?.TLS_SKIP_VERIFY === 'true') {
      clientOptions.tlsOptions = {
        rejectUnauthorized: context.environment?.TLS_SKIP_VERIFY !== 'true'
      };
    }

    const client = new ldapts.Client(clientOptions);

    try {
      console.log(`Connecting to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);
      console.log('Successfully authenticated to LDAP server');

      // Lookup user DN by sAMAccountName
      const userDN = await findUserDN(client, baseDN, samAccountName);

      console.log(`Adding user to group: ${groupDN}`);
      await addUserToGroup(userDN, groupDN, client);

      console.log(`Successfully added user "${userDN}" to group "${groupDN}"`);
      return {
        status: 'success',
        userDN,
        groupDN,
        added: true,
        address
      };
    } catch (error) {
      // LDAP error code 68: ENTRY_ALREADY_EXISTS - user is already a member
      if (error.code === 68) {
        // Need to get userDN for the response - it might have been found before error
        let userDN = 'unknown';
        try {
          userDN = await findUserDN(client, baseDN, samAccountName);
        } catch (lookupError) {
          console.warn(`Warning: Could not retrieve user DN for response: ${lookupError.message}`);
        }
        console.log(`User "${userDN}" is already a member of group "${groupDN}"`);
        return {
          status: 'success',
          userDN,
          groupDN,
          added: false,
          message: 'User is already a member of the group',
          address
        };
      }

      console.error(`Failed to add user to group: ${error.message}`);
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
    const { error, baseDN, samAccountName, groupDN } = params;
    console.error(`Error handler invoked for adding "${samAccountName}" to "${groupDN}": ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    // Authentication errors (fatal - don't retry)
    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check LDAP_BIND_DN and LDAP_BIND_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    // Connection errors (retryable - framework will retry)
    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused')) {
      console.error('Connection error - may be transient, framework will retry');
      throw error;
    }

    // User not found (fatal - don't retry)
    if (errorMessage.includes('user not found')) {
      console.error('User not found - check samAccountName and baseDN');
      throw new Error(`User not found: ${error.message}`);
    }

    // Multiple users found (fatal - don't retry)
    if (errorMessage.includes('multiple users found')) {
      console.error('Multiple users found - sAMAccountName should be unique');
      throw new Error(`Multiple users found: ${error.message}`);
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
    console.log(`Active Directory add user to group operation halted: ${reason}`);

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

module.exports = script;
