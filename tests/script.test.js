import { jest } from '@jest/globals';

// Mock ldapts before importing script
const mockBind = jest.fn();
const mockUnbind = jest.fn();
const mockModify = jest.fn();

jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    modify: mockModify
  })),
  Change: jest.fn().mockImplementation((opts) => ({
    operation: opts.operation,
    modification: opts.modification
  })),
  Attribute: jest.fn().mockImplementation((opts) => ({
    [opts.type]: opts.values
  }))
}));

// Mock @sgnl-actions/utils
jest.unstable_mockModule('@sgnl-actions/utils', () => ({
  getBaseURL: jest.fn()
}));

const { Client } = await import('ldapts');
const { getBaseURL } = await import('@sgnl-actions/utils');
const { default: script } = await import('../src/script.mjs');

describe('AD Add User to Group Script', () => {
  const mockContext = {
    environment: {
      ADDRESS: 'ldaps://ad.corp.example.com:636'
    },
    secrets: {
      LDAP_BIND_DN: 'CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com',
      LDAP_BIND_PASSWORD: 'test-password'
    }
  };

  const defaultParams = {
    userDN: 'CN=John Doe,OU=Users,DC=corp,DC=example,DC=com',
    groupDN: 'CN=Test Group,OU=Groups,DC=corp,DC=example,DC=com'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.console.log = jest.fn();
    global.console.error = jest.fn();
    getBaseURL.mockReturnValue('ldaps://ad.corp.example.com:636');
    mockBind.mockResolvedValue(undefined);
    mockUnbind.mockResolvedValue(undefined);
    mockModify.mockResolvedValue(undefined);
  });

  describe('invoke handler', () => {
    test('should successfully add user to group', async () => {
      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(result.userDN).toBe(defaultParams.userDN);
      expect(result.groupDN).toBe(defaultParams.groupDN);
      expect(result.added).toBe(true);
      expect(result.address).toBe('ldaps://ad.corp.example.com:636');

      // Verify Client was constructed with correct URL and options
      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://ad.corp.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: true }
      });

      // Verify bind was called with correct credentials
      expect(mockBind).toHaveBeenCalledWith(
        'CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com',
        'test-password'
      );

      // Verify modify was called with correct DN and change
      expect(mockModify).toHaveBeenCalledWith(
        defaultParams.groupDN,
        [
          {
            operation: 'add',
            modification: {
              member: [defaultParams.userDN]
            }
          }
        ]
      );

      // Verify unbind was called
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should handle user already a member (LDAP error code 68)', async () => {
      const ldapError = new Error('Entry Already Exists');
      ldapError.code = 68;
      mockModify.mockRejectedValueOnce(ldapError);

      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(result.userDN).toBe(defaultParams.userDN);
      expect(result.groupDN).toBe(defaultParams.groupDN);
      expect(result.added).toBe(false);
      expect(result.message).toBe('User is already a member of the group');
      expect(result.address).toBe('ldaps://ad.corp.example.com:636');

      // Verify unbind was still called
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should throw on LDAP errors other than code 68', async () => {
      const ldapError = new Error('No such object');
      ldapError.code = 32;
      mockModify.mockRejectedValueOnce(ldapError);

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow('No such object');

      // Verify unbind was still called
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should throw on bind failure', async () => {
      mockBind.mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow('Invalid credentials');

      // Verify unbind was still called
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should throw when LDAP_BIND_DN is missing', async () => {
      const contextMissingUsername = {
        ...mockContext,
        secrets: {
          LDAP_BIND_PASSWORD: 'test-password'
        }
      };

      await expect(script.invoke(defaultParams, contextMissingUsername)).rejects.toThrow(
        'Missing LDAP bind credentials'
      );
    });

    test('should throw when LDAP_BIND_PASSWORD is missing', async () => {
      const contextMissingPassword = {
        ...mockContext,
        secrets: {
          LDAP_BIND_DN: 'CN=svc-sgnl,OU=Service Accounts,DC=corp,DC=example,DC=com'
        }
      };

      await expect(script.invoke(defaultParams, contextMissingPassword)).rejects.toThrow(
        'Missing LDAP bind credentials'
      );
    });

    test('should set TLS rejectUnauthorized to false when TLS_SKIP_VERIFY is true', async () => {
      const contextWithTlsSkip = {
        ...mockContext,
        environment: {
          ...mockContext.environment,
          TLS_SKIP_VERIFY: 'true'
        }
      };

      await script.invoke(defaultParams, contextWithTlsSkip);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://ad.corp.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      });
    });

    test('should set rejectUnauthorized to true for ldaps:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      await script.invoke(defaultParams, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://ad.corp.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: true }
      });
    });

    test('should not include tlsOptions for ldap:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      getBaseURL.mockReturnValue('ldap://ad.corp.example.com:389');

      await script.invoke(defaultParams, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldap://ad.corp.example.com:389',
        timeout: 10000,
        connectTimeout: 10000
      });
    });

    test('should use address from params via getBaseURL', async () => {
      const paramsWithAddress = {
        ...defaultParams,
        address: 'ldaps://custom-ad.corp.example.com:636'
      };
      getBaseURL.mockReturnValue('ldaps://custom-ad.corp.example.com:636');

      const result = await script.invoke(paramsWithAddress, mockContext);

      expect(getBaseURL).toHaveBeenCalledWith(paramsWithAddress, mockContext);
      expect(result.address).toBe('ldaps://custom-ad.corp.example.com:636');
    });

    test('should call getBaseURL with params and context', async () => {
      await script.invoke(defaultParams, mockContext);

      expect(getBaseURL).toHaveBeenCalledWith(defaultParams, mockContext);
    });

    test('should throw when userDN is missing', async () => {
      const params = { groupDN: defaultParams.groupDN };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('userDN is required');
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should throw when groupDN is missing', async () => {
      const params = { userDN: defaultParams.userDN };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('groupDN is required');
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should handle unbind errors gracefully', async () => {
      mockUnbind.mockRejectedValueOnce(new Error('Unbind failed'));

      const result = await script.invoke(defaultParams, mockContext);

      expect(result.status).toBe('success');
      expect(result.added).toBe(true);
    });

    test('should not mask original error when unbind also fails', async () => {
      mockModify.mockRejectedValueOnce(new Error('Modify operation failed'));
      mockUnbind.mockRejectedValueOnce(new Error('Unbind failed'));

      await expect(script.invoke(defaultParams, mockContext)).rejects.toThrow('Modify operation failed');
    });

    test('should return dry_run_completed when dry_run is true', async () => {
      const params = { ...defaultParams, dry_run: true };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.userDN).toBe(defaultParams.userDN);
      expect(result.groupDN).toBe(defaultParams.groupDN);
      expect(result.added).toBe(false);
      expect(mockBind).not.toHaveBeenCalled();
      expect(mockModify).not.toHaveBeenCalled();
    });
  });

  describe('error handler', () => {
    test('should re-throw connection errors for framework retry', async () => {
      const errorObj = new Error('LDAP connection refused');
      const params = {
        ...defaultParams,
        error: errorObj
      };

      await expect(script.error(params, mockContext)).rejects.toThrow(errorObj);
    });

    test('should wrap authentication errors', async () => {
      const errorObj = new Error('Invalid credentials');
      const params = {
        ...defaultParams,
        error: errorObj
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('LDAP authentication failed');
    });

    test('should wrap permission errors', async () => {
      const errorObj = new Error('Insufficient access rights');
      const params = {
        ...defaultParams,
        error: errorObj
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Insufficient LDAP permissions');
    });

    test('should wrap not found errors', async () => {
      const errorObj = new Error('No such object');
      const params = {
        ...defaultParams,
        error: errorObj
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Resource not found');
    });
  });

  describe('halt handler', () => {
    test('should handle graceful shutdown with parameters', async () => {
      const params = {
        ...defaultParams,
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userDN).toBe(defaultParams.userDN);
      expect(result.groupDN).toBe(defaultParams.groupDN);
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without userDN and groupDN', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userDN).toBe('unknown');
      expect(result.groupDN).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});
