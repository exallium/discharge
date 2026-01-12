/**
 * Tests for database encryption utilities
 */

import { encrypt, decrypt, generateEncryptionKey, isEncryptionAvailable, clearEncryptionKeyCache } from '../../../src/db/encryption';

describe('Encryption utilities', () => {
  describe('generateEncryptionKey', () => {
    it('should generate a valid base64-encoded 32-byte key', () => {
      const key = generateEncryptionKey();
      const decoded = Buffer.from(key, 'base64');

      expect(decoded.length).toBe(32);
      expect(key).toMatch(/^[A-Za-z0-9+/]+=*$/); // Valid base64
    });

    it('should generate unique keys each time', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('isEncryptionAvailable', () => {
    it('should return true when DB_ENCRYPTION_KEY is set', () => {
      expect(isEncryptionAvailable()).toBe(true);
    });

    it('should return false when DB_ENCRYPTION_KEY is not set', () => {
      const originalKey = process.env.DB_ENCRYPTION_KEY;
      delete process.env.DB_ENCRYPTION_KEY;
      clearEncryptionKeyCache(); // Clear cached key

      expect(isEncryptionAvailable()).toBe(false);

      process.env.DB_ENCRYPTION_KEY = originalKey;
      clearEncryptionKeyCache(); // Clear again to reset
    });
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('should encrypt and decrypt an empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt special characters', () => {
      const plaintext = 'Token: ghp_abc123!@#$%^&*()_+-=[]{}|;\':",.<>?/\\`~';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt unicode characters', () => {
      const plaintext = 'Hello 世界 🌍 émojis';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt long strings', () => {
      const plaintext = 'A'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same plaintext (due to random IV)', () => {
      const plaintext = 'Test message';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(decrypt(encrypted1)).toBe(plaintext);
      expect(decrypt(encrypted2)).toBe(plaintext);
    });

    it('should throw an error when decrypting invalid ciphertext', () => {
      expect(() => decrypt('invalid-ciphertext')).toThrow();
    });

    it('should throw an error when decrypting tampered ciphertext', () => {
      const encrypted = encrypt('Test message');
      // Tamper with the ciphertext
      const tampered = encrypted.slice(0, -2) + 'XX';

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('encrypt without key', () => {
    it('should throw an error when DB_ENCRYPTION_KEY is not set', () => {
      const originalKey = process.env.DB_ENCRYPTION_KEY;
      delete process.env.DB_ENCRYPTION_KEY;
      clearEncryptionKeyCache(); // Clear cached key

      expect(() => encrypt('test')).toThrow('DB_ENCRYPTION_KEY');

      process.env.DB_ENCRYPTION_KEY = originalKey;
      clearEncryptionKeyCache(); // Clear again to reset
    });
  });
});
