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
    test('should throw error by default', async () => {
      const params = {
        target: 'test-user@example.com',
        action: 'create',
        error: {
          message: 'Something went wrong',
          code: 'ERROR_CODE'
        }
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Unable to recover from error: Something went wrong');
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
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without target', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.target).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});