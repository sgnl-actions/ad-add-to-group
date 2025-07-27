import { jest } from '@jest/globals';
import script from '../src/script.mjs';

describe('Job Template Script', () => {
  const mockContext = {
    env: {
      ENVIRONMENT: 'test'
    },
    secrets: {
      API_KEY: 'test-api-key-123456'
    },
    outputs: {},
    partial_results: {},
    current_step: 'start'
  };

  describe('invoke handler', () => {
    test('should execute successfully with minimal params', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'create'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.target).toBe('test-user@example.com');
      expect(result.action).toBe('create');
      expect(result.status).toBeDefined();
      expect(result.processed_at).toBeDefined();
      expect(result.options_processed).toBe(0);
    });

    test('should handle dry run mode', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'delete',
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.target).toBe('test-user@example.com');
      expect(result.action).toBe('delete');
    });

    test('should process options array', async () => {
      const params = {
        target: 'test-group',
        action: 'update',
        options: ['force', 'notify', 'audit']
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.target).toBe('test-group');
      expect(result.options_processed).toBe(3);
    });

    test('should handle context with previous job outputs', async () => {
      const contextWithOutputs = {
        ...mockContext,
        outputs: {
          'create-user': {
            user_id: '12345',
            created_at: '2024-01-15T10:30:00Z'
          },
          'assign-groups': {
            groups_assigned: 3
          }
        }
      };

      const params = {
        target: 'user-12345',
        action: 'finalize'
      };

      const result = await script.invoke(params, contextWithOutputs);

      expect(result.status).toBe('success');
      expect(result.target).toBe('user-12345');
      expect(result.status).toBeDefined();
    });
  });

  describe('error handler', () => {
    test('should recover from rate limit errors', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'create',
        error: {
          message: 'API rate limit exceeded - 429',
          code: 'RATE_LIMIT'
        }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('recovered');
      expect(result.target).toBe('test-user@example.com');
      expect(result.recovery_method).toBe('rate_limit_backoff');
      expect(result.original_error).toContain('rate limit');
      expect(result.status).toBeDefined();
    });

    test('should use fallback for service unavailable', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'update',
        error: {
          message: 'Service unavailable - 503',
          code: 'SERVICE_UNAVAILABLE'
        }
      };

      const result = await script.error(params, mockContext);

      expect(result.status).toBe('fallback_used');
      expect(result.target).toBe('test-user@example.com');
      expect(result.recovery_method).toBe('fallback_service');
      expect(result.original_error).toContain('Service unavailable');
    });

    test('should throw for unrecoverable errors', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'create',
        error: {
          message: 'Invalid configuration - missing API key',
          code: 'CONFIG_ERROR'
        }
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Unrecoverable error');
    });
  });

  describe('halt handler', () => {
    test('should handle graceful shutdown', async () => {
      const params = {
        target: 'test-user@example.com',
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.target).toBe('test-user@example.com');
      expect(result.reason).toBe('timeout');
      expect(result.cleanup_completed).toBe(true);
      expect(result.halted_at).toBeDefined();
      expect(result.status).toBeDefined();
    });

    test('should save partial results when available', async () => {
      const contextWithPartialResults = {
        ...mockContext,
        partial_results: {
          processed_count: 5,
          total_count: 10,
          completed_items: ['item1', 'item2', 'item3']
        }
      };

      const params = {
        target: 'batch-operation',
        reason: 'cancellation'
      };

      const result = await script.halt(params, contextWithPartialResults);

      expect(result.status).toBe('halted');
      expect(result.partial_results_saved).toBe(true);
      expect(result.reason).toBe('cancellation');
    });

    test('should handle halt without target', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.target).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
      expect(result.cleanup_completed).toBe(true);
    });
  });
});