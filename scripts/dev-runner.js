#!/usr/bin/env node

/**
 * Development runner for testing scripts locally
 */

import script from '../src/script.mjs';

const mockContext = {
  env: {
    ENVIRONMENT: 'development'
  },
  secrets: {
    API_KEY: 'dev-test-key-123456'
  },
  outputs: {},
  partial_results: {},
  current_step: 'start'
};

const mockParams = {
  target: 'dev-test@example.com',
  action: 'create',
  options: ['notify', 'audit'],
  dry_run: false
};

async function runDev() {
  console.log('🚀 Running job script in development mode...\n');
  
  console.log('📋 Parameters:', JSON.stringify(mockParams, null, 2));
  console.log('🔧 Context:', JSON.stringify(mockContext, null, 2));
  console.log('\n' + '='.repeat(50) + '\n');
  
  try {
    const result = await script.invoke(mockParams, mockContext);
    console.log('\n' + '='.repeat(50));
    console.log('✅ Job completed successfully!');
    console.log('📤 Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.error('❌ Job failed:', error.message);
    
    if (script.error) {
      console.log('\n🔄 Attempting error recovery...');
      try {
        const recovery = await script.error({...mockParams, error}, mockContext);
        console.log('✅ Recovery successful!');
        console.log('📤 Recovery result:', JSON.stringify(recovery, null, 2));
      } catch (recoveryError) {
        console.error('❌ Recovery failed:', recoveryError.message);
      }
    }
  }
}

runDev().catch(console.error);