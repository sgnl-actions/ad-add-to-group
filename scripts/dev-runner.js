#!/usr/bin/env node

/**
 * Development runner for testing scripts locally
 *
 * Configuration is read from environment variables. Set them in:
 * - Parent directory's .env file (loaded via --env-file flag)
 * - Shell environment variables
 * - Or override inline below
 */

import script from '../src/script.mjs';

// Read configuration from environment variables (set in ../.env)
const mockContext = {
  environment: {
    ADDRESS: process.env.ADDRESS || 'ldap://localhost:389',
    TLS_SKIP_VERIFY: process.env.TLS_SKIP_VERIFY || 'false'
  },
  secrets: {
    BASIC_USERNAME: process.env.BASIC_USERNAME || '',
    BASIC_PASSWORD: process.env.BASIC_PASSWORD || ''
  },
  outputs: {},
  partial_results: {},
  current_step: 'start'
};

// Action-specific parameters - customize these for your test
const mockParams = {
  baseDN: process.env.BASE_DN || 'DC=corp,DC=example,DC=com',
  samAccountName: process.env.SAM_ACCOUNT_NAME || 'jsmith',
  groupDN: process.env.GROUP_DN || 'CN=Engineering Team,OU=Groups,DC=corp,DC=example,DC=com',
  dry_run: process.env.DRY_RUN === 'true'
};

// Optional: TTL for AD temporary group membership. Only include when set so the
// action sees `undefined` rather than `NaN` when the env var is empty.
if (process.env.TTL_SECONDS) {
  mockParams.ttlSeconds = parseInt(process.env.TTL_SECONDS, 10);
}

async function runDev() {
  console.log('Running job script in development mode...\n');

  // Validate required environment variables
  if (!mockContext.secrets.BASIC_USERNAME || !mockContext.secrets.BASIC_PASSWORD) {
    console.error('ERROR: Missing required environment variables.');
    console.error('Set BASIC_USERNAME and BASIC_PASSWORD in ../.env or environment.');
    console.error('\nExample:');
    console.error('  export BASIC_USERNAME="CN=admin,DC=example,DC=com"');
    console.error('  export BASIC_PASSWORD="password"');
    process.exit(1);
  }

  console.log('Parameters:', JSON.stringify(mockParams, null, 2));
  console.log('Context:', JSON.stringify({
    ...mockContext,
    secrets: { BASIC_USERNAME: mockContext.secrets.BASIC_USERNAME, BASIC_PASSWORD: '***' }
  }, null, 2));
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const result = await script.invoke(mockParams, mockContext);
    console.log('\n' + '='.repeat(50));
    console.log('Job completed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.error('Job failed:', error.message);

    if (script.error) {
      console.log('\nAttempting error recovery...');
      try {
        const recovery = await script.error({ ...mockParams, error }, mockContext);
        console.log('Recovery successful!');
        console.log('Recovery result:', JSON.stringify(recovery, null, 2));
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError.message);
      }
    }
  }
}

runDev().catch(console.error);
