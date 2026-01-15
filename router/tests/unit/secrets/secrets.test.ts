/**
 * Tests for secrets management module
 *
 * Verifies that secrets are properly decrypted when retrieved.
 */

import { getSecret, setSecret, deleteSecret, hasSecret } from '../../../src/secrets';
import { settingsRepo } from '../../../src/db/repositories';
import { encrypt } from '../../../src/db/encryption';

// Mock the settings repository
jest.mock('../../../src/db/repositories', () => ({
  settingsRepo: {
    get: jest.fn(),
    getDecrypted: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    getByCategory: jest.fn(),
  },
}));

// Mock the logger
jest.mock('../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Secrets module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_WEBHOOK_SECRET;
  });

  describe('getSecret', () => {
    it('should retrieve project-specific secret using getDecrypted', async () => {
      const mockDecryptedValue = 'decrypted-secret-value';
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValueOnce(mockDecryptedValue);

      const result = await getSecret('github', 'token', 'my-project');

      expect(settingsRepo.getDecrypted).toHaveBeenCalledWith('projects:my-project:github:token');
      expect(result).toBe(mockDecryptedValue);
    });

    it('should fall back to global secret when project-specific not found', async () => {
      const mockDecryptedValue = 'global-secret-value';
      (settingsRepo.getDecrypted as jest.Mock)
        .mockResolvedValueOnce(undefined) // project-specific returns undefined
        .mockResolvedValueOnce(mockDecryptedValue); // global returns value

      const result = await getSecret('github', 'token', 'my-project');

      expect(settingsRepo.getDecrypted).toHaveBeenCalledWith('projects:my-project:github:token');
      expect(settingsRepo.getDecrypted).toHaveBeenCalledWith('github:token');
      expect(result).toBe(mockDecryptedValue);
    });

    it('should fall back to environment variable when DB secrets not found', async () => {
      process.env.GITHUB_TOKEN = 'env-token-value';
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValue(undefined);

      const result = await getSecret('github', 'token');

      expect(result).toBe('env-token-value');
    });

    it('should return null when secret not found anywhere', async () => {
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValue(undefined);

      const result = await getSecret('github', 'token');

      expect(result).toBeNull();
    });

    it('should use custom env override when provided', async () => {
      process.env.MY_CUSTOM_TOKEN = 'custom-env-value';
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValue(undefined);

      const result = await getSecret('github', 'token', undefined, 'MY_CUSTOM_TOKEN');

      expect(result).toBe('custom-env-value');

      delete process.env.MY_CUSTOM_TOKEN;
    });

    it('should not call project lookup when no projectId provided', async () => {
      const mockDecryptedValue = 'global-secret';
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValueOnce(mockDecryptedValue);

      const result = await getSecret('github', 'token');

      expect(settingsRepo.getDecrypted).toHaveBeenCalledTimes(1);
      expect(settingsRepo.getDecrypted).toHaveBeenCalledWith('github:token');
      expect(result).toBe(mockDecryptedValue);
    });

    it('should handle errors gracefully and return null', async () => {
      (settingsRepo.getDecrypted as jest.Mock).mockRejectedValue(new Error('DB connection failed'));

      const result = await getSecret('github', 'token');

      expect(result).toBeNull();
    });
  });

  describe('setSecret', () => {
    it('should store project-specific secret with encryption', async () => {
      await setSecret('github', 'token', 'my-secret-value', 'my-project');

      expect(settingsRepo.set).toHaveBeenCalledWith(
        'projects:my-project:github:token',
        'my-secret-value',
        expect.objectContaining({
          encrypted: true,
          category: 'project-secrets',
        })
      );
    });

    it('should store global secret with encryption', async () => {
      await setSecret('github', 'token', 'my-secret-value');

      expect(settingsRepo.set).toHaveBeenCalledWith(
        'github:token',
        'my-secret-value',
        expect.objectContaining({
          encrypted: true,
          category: 'secrets',
        })
      );
    });
  });

  describe('deleteSecret', () => {
    it('should delete project-specific secret', async () => {
      await deleteSecret('github', 'token', 'my-project');

      expect(settingsRepo.remove).toHaveBeenCalledWith('projects:my-project:github:token');
    });

    it('should delete global secret', async () => {
      await deleteSecret('github', 'token');

      expect(settingsRepo.remove).toHaveBeenCalledWith('github:token');
    });
  });

  describe('hasSecret', () => {
    it('should return true when secret exists', async () => {
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValueOnce('some-value');

      const result = await hasSecret('github', 'token');

      expect(result).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      (settingsRepo.getDecrypted as jest.Mock).mockResolvedValue(undefined);

      const result = await hasSecret('github', 'token');

      expect(result).toBe(false);
    });
  });
});
