/**
 * Active Directory Add User to Group Action
 *
 * Adds a user to a group in on-premise Active Directory using LDAP/LDAPS.
 */

import { Client } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/**
 * Helper function to add a user to a group in Active Directory
 * @param {string} userDN - Distinguished Name of the user
 * @param {string} groupDN - Distinguished Name of the group
 * @param {Client} client - Bound ldapts Client instance
 * @returns {Promise<{success: boolean}>}
 */
async function addUserToGroup(userDN, groupDN, client) {
  await client.modify(groupDN, [
    {
      operation: 'add',
      modification: {
        member: [userDN]
      }
    }
  ]);

  return { success: true };
}

export default {
  /**
   * Main execution handler - adds a user to a group in on-premise Active Directory
   * @param {Object} params - Job input parameters
   * @param {string} params.userDN - Distinguished Name of the user
   * @param {string} params.groupDN - Distinguished Name of the group
   * @param {string} [params.address] - Optional LDAP server URL override
   * @param {Object} context - Execution context with env, secrets, outputs
   * @param {string} context.environment.ADDRESS - Default LDAP server URL
   * @param {string} context.secrets.BASIC_USERNAME - Bind DN for LDAP authentication
   * @param {string} context.secrets.BASIC_PASSWORD - Bind password for LDAP authentication
   * @param {string} [context.environment.TLS_SKIP_VERIFY] - Set to 'true' to skip TLS certificate verification
   * @returns {Object} Job results
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory add user to group operation');

    const { userDN, groupDN } = params;

    // Get LDAP server URL using shared utility
    const address = getBaseURL(params, context);

    // Get bind credentials from secrets
    const bindDN = context.secrets.BASIC_USERNAME;
    const bindPassword = context.secrets.BASIC_PASSWORD;

    if (!bindDN || !bindPassword) {
      throw new Error('Missing LDAP bind credentials. Provide BASIC_USERNAME and BASIC_PASSWORD in secrets.');
    }

    // Build TLS options
    const tlsOptions = {};
    if (context.environment?.TLS_SKIP_VERIFY === 'true') {
      tlsOptions.rejectUnauthorized = false;
    }

    const client = new Client({
      url: address,
      tlsOptions
    });

    try {
      console.log(`Binding to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);

      console.log(`Adding user ${userDN} to group ${groupDN}`);
      await addUserToGroup(userDN, groupDN, client);

      console.log(`Successfully added user ${userDN} to group ${groupDN}`);
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
        console.log(`User ${userDN} is already a member of group ${groupDN}`);
        return {
          status: 'success',
          userDN,
          groupDN,
          added: false,
          message: 'User is already a member of the group',
          address
        };
      }

      console.error(`Error adding user to group: ${error.message}`);
      throw error;
    } finally {
      await client.unbind();
    }
  },

  /**
   * Error recovery handler - framework handles retries by default
   * @param {Object} params - Original params plus error information
   * @param {Object} _context - Execution context
   */
  error: async (params, _context) => {
    const { error, userDN, groupDN } = params;
    console.error(`User group assignment failed for user ${userDN} to group ${groupDN}: ${error.message}`);

    throw error;
  },

  /**
   * Graceful shutdown handler - performs cleanup
   * @param {Object} params - Original params plus halt reason
   * @param {Object} _context - Execution context
   * @returns {Object} Cleanup results
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
