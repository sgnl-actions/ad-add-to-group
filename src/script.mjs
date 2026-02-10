/**
 * Active Directory Add User to Group Action
 *
 * Adds a user to a group in on-premise Active Directory using LDAP/LDAPS.
 * If the user is already a member, returns success with added=false.
 */

import { Client, Change, Attribute } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

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
    new Change({
      operation: 'add',
      modification: new Attribute({
        type: 'member',
        values: [userDN]
      })
    })
  ]);

  return { success: true };
}

export default {
  /**
   * Main execution handler - adds a user to a group in Active Directory.
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.userDN - Distinguished Name of the user to add
   * @param {string} params.groupDN - Distinguished Name of the group
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, userDN, groupDN, and added flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory add user to group operation');

    const { userDN, groupDN, dry_run = false } = params;

    // Validate required parameters
    if (!userDN) {
      throw new Error('userDN is required');
    }
    if (!groupDN) {
      throw new Error('groupDN is required');
    }

    console.log(`Planning to add user "${userDN}" to group "${groupDN}"`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      return {
        status: 'dry_run_completed',
        userDN,
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

    const client = new Client(clientOptions);

    try {
      console.log(`Connecting to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);
      console.log('Successfully authenticated to LDAP server');

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
   * @param {string} params.userDN - The user DN being added
   * @param {string} params.groupDN - The group DN being modified
   * @param {Object} _context - Execution context (unused)
   * @throws {Error} Re-throws with appropriate classification
   */
  error: async (params, _context) => {
    const { error, userDN, groupDN } = params;
    console.error(`Error handler invoked for adding "${userDN}" to "${groupDN}": ${error.message}`);

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

    // Not found (fatal - don't retry)
    if (errorMessage.includes('not found') ||
        errorMessage.includes('no such object')) {
      console.error('User or group not found - check userDN and groupDN');
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
   * @param {string} [params.userDN] - The user DN being added
   * @param {string} [params.groupDN] - The group DN being modified
   * @param {Object} _context - Execution context (unused)
   * @returns {Object} Cleanup results with halted status
   */
  halt: async (params, _context) => {
    const { reason, userDN, groupDN } = params;
    console.log(`Active Directory add user to group operation halted: ${reason}`);

    return {
      status: 'halted',
      userDN: userDN || 'unknown',
      groupDN: groupDN || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};
