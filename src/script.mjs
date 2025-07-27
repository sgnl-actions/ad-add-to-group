/**
 * SGNL Job Template
 * 
 * This template provides a starting point for implementing SGNL jobs.
 * Replace this implementation with your specific business logic.
 */

export default {
  /**
   * Main execution handler - implement your job logic here
   * @param {Object} params - Job input parameters
   * @param {Object} context - Execution context with env, secrets, outputs
   * @returns {Object} Job results
   */
  invoke: async (params, context) => {
    console.log('Starting job execution');
    console.log(`Processing target: ${params.target}`);
    console.log(`Action: ${params.action}`);
    
    // TODO: Replace with your implementation
    const { target, action, options = [], dry_run = false } = params;
    
    if (dry_run) {
      console.log('DRY RUN: No changes will be made');
    }
    
    // Access environment variables
    const environment = context.env.ENVIRONMENT || 'development';
    console.log(`Running in ${environment} environment`);
    
    // Access secrets securely (example)
    if (context.secrets.API_KEY) {
      console.log(`Using API key ending in ...${context.secrets.API_KEY.slice(-4)}`);
    }
    
    // Use outputs from previous jobs in workflow
    if (context.outputs && Object.keys(context.outputs).length > 0) {
      console.log(`Available outputs from ${Object.keys(context.outputs).length} previous jobs`);
      console.log(`Previous job outputs: ${Object.keys(context.outputs).join(', ')}`);
    }
    
    // Simulate work
    console.log(`Performing ${action} on ${target}...`);
    
    if (options.length > 0) {
      console.log(`Processing ${options.length} options: ${options.join(', ')}`);
    }
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`Successfully completed ${action} on ${target}`);
    
    // Return structured results
    return {
      status: dry_run ? 'dry_run_completed' : 'success',
      target: target,
      action: action,
      options_processed: options.length,
      environment: environment,
      processed_at: new Date().toISOString(),
      // Job completed successfully
    };
  },

  /**
   * Error recovery handler - implement error handling logic
   * @param {Object} params - Original params plus error information
   * @param {Object} context - Execution context
   * @returns {Object} Recovery results
   */
  error: async (params, context) => {
    const { error, target, action } = params;
    console.error(`Job encountered error while processing ${target}: ${error.message}`);
    
    // TODO: Implement your error recovery logic
    
    // Example: Retry with different approach
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      console.log('Rate limited - implementing backoff strategy');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      console.log(`Retrying ${action} on ${target} after backoff`);
      
      return {
        status: 'recovered',
        target: target,
        recovery_method: 'rate_limit_backoff',
        original_error: error.message,
        recovered_at: new Date().toISOString(),
        // Job completed successfully
      };
    }
    
    // Example: Fallback approach
    if (error.message.includes('service unavailable') || error.message.includes('503')) {
      console.log('Primary service unavailable - using fallback approach');
      
      return {
        status: 'fallback_used',
        target: target,
        recovery_method: 'fallback_service',
        original_error: error.message,
        recovered_at: new Date().toISOString(),
        // Job completed successfully
      };
    }
    
    // Cannot recover from this error
    console.error(`Unable to recover from error for ${target}`);
    throw new Error(`Unrecoverable error processing ${target}: ${error.message}`);
  },

  /**
   * Graceful shutdown handler - implement cleanup logic
   * @param {Object} params - Original params plus halt reason
   * @param {Object} context - Execution context
   * @returns {Object} Cleanup results
   */
  halt: async (params, context) => {
    const { reason, target } = params;
    console.log(`Job is being halted (${reason}) while processing ${target}`);
    
    // TODO: Implement your cleanup logic
    
    // Save any partial progress
    if (context.partial_results) {
      console.log('Saving partial results before shutdown');
      // Example: await savePartialResults(context.partial_results);
    }
    
    // Clean up resources
    console.log('Performing cleanup operations');
    // Example: await cleanupResources();
    
    return {
      status: 'halted',
      target: target || 'unknown',
      reason: reason,
      halted_at: new Date().toISOString(),
      cleanup_completed: true,
      partial_results_saved: !!context.partial_results,
      // Job completed successfully
    };
  }
};