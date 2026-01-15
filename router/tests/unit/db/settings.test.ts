/**
 * Tests for settings repository
 *
 * Verifies admin credential initialization uses consistent keys.
 */

import bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockedhashvalue'),
  compare: jest.fn(),
}));

// Mock drizzle database
const mockDb = {
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
  insert: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([]),
};

jest.mock('../../../src/db/index', () => ({
  getDatabase: () => mockDb,
  settings: { key: 'key' },
}));

// Mock logger
jest.mock('../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock encryption
jest.mock('../../../src/db/encryption', () => ({
  encrypt: jest.fn((v: string) => `encrypted:${v}`),
  decrypt: jest.fn((v: string) => v.replace('encrypted:', '')),
  isEncryptionAvailable: jest.fn().mockReturnValue(true),
}));

// Import after mocking
import * as settingsRepo from '../../../src/db/repositories/settings';

describe('Settings repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    mockDb.limit.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
  });

  describe('initializeAdminFromEnv', () => {
    it('should use admin:password key consistent with auth.ts', async () => {
      process.env.ADMIN_PASSWORD = 'test-password';
      process.env.ADMIN_USERNAME = 'testadmin';

      await settingsRepo.initializeAdminFromEnv();

      // Verify set was called with correct key format (admin:password, not admin.password_hash)
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'admin:password',
        })
      );
    });

    it('should use admin:username key consistent with auth.ts', async () => {
      process.env.ADMIN_PASSWORD = 'test-password';
      process.env.ADMIN_USERNAME = 'testadmin';

      await settingsRepo.initializeAdminFromEnv();

      // Check that admin:username was stored (not admin.username)
      const allCalls = mockDb.values.mock.calls;
      const usernameCall = allCalls.find(
        (call: unknown[]) => (call[0] as { key: string }).key === 'admin:username'
      );
      expect(usernameCall).toBeTruthy();
      expect(usernameCall[0].value).toBe('testadmin');
    });

    it('should hash password with bcrypt', async () => {
      process.env.ADMIN_PASSWORD = 'test-password';

      await settingsRepo.initializeAdminFromEnv();

      expect(bcrypt.hash).toHaveBeenCalledWith('test-password', 12);
    });

    it('should not initialize if admin:password already exists', async () => {
      // Mock that password already exists
      mockDb.limit.mockResolvedValueOnce([{ value: 'existing-hash' }]);

      process.env.ADMIN_PASSWORD = 'new-password';

      const result = await settingsRepo.initializeAdminFromEnv();

      expect(result).toBe(false);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('should return false if ADMIN_PASSWORD env var not set', async () => {
      // No ADMIN_PASSWORD env var

      const result = await settingsRepo.initializeAdminFromEnv();

      expect(result).toBe(false);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('should use default username "admin" if ADMIN_USERNAME not set', async () => {
      process.env.ADMIN_PASSWORD = 'test-password';
      // ADMIN_USERNAME not set

      await settingsRepo.initializeAdminFromEnv();

      const allCalls = mockDb.values.mock.calls;
      const usernameCall = allCalls.find(
        (call: unknown[]) => (call[0] as { key: string }).key === 'admin:username'
      );
      expect(usernameCall).toBeTruthy();
      expect(usernameCall[0].value).toBe('admin');
    });
  });

  describe('get vs getDecrypted', () => {
    it('get should return raw value without decryption', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: 'encrypted:secret', encrypted: true }]);

      const result = await settingsRepo.get('some:key');

      expect(result).toBe('encrypted:secret');
    });

    it('getDecrypted should decrypt encrypted values', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: 'encrypted:secret', encrypted: true }]);

      const result = await settingsRepo.getDecrypted('some:key');

      expect(result).toBe('secret');
    });

    it('getDecrypted should return plain value for non-encrypted settings', async () => {
      mockDb.limit.mockResolvedValueOnce([{ value: 'plain-value', encrypted: false }]);

      const result = await settingsRepo.getDecrypted('some:key');

      expect(result).toBe('plain-value');
    });
  });
});
