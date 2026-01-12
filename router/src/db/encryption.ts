/**
 * Encryption utilities for sensitive settings
 *
 * Uses AES-256-GCM for authenticated encryption of secrets stored in the database.
 * The encryption key is provided via DB_ENCRYPTION_KEY environment variable.
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

// Cached encryption key
let encryptionKey: Buffer | null = null;

/**
 * Get the encryption key from environment
 * Key should be a 32-byte value encoded as base64
 */
function getEncryptionKey(): Buffer {
  if (encryptionKey) {
    return encryptionKey;
  }

  const keyString = process.env.DB_ENCRYPTION_KEY;
  if (!keyString) {
    throw new Error('DB_ENCRYPTION_KEY environment variable is not set');
  }

  const key = Buffer.from(keyString, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `DB_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 8} bits) when decoded from base64. ` +
      `Got ${key.length} bytes. Generate with: openssl rand -base64 32`
    );
  }

  encryptionKey = key;
  return key;
}

/**
 * Check if encryption is available (key is configured)
 */
export function isEncryptionAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext string
 *
 * @param plaintext - The string to encrypt
 * @returns Base64-encoded ciphertext in format: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();

  // Generate random IV
  const iv = randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + ciphertext and encode as base64
  // Format: base64(iv) + ':' + base64(authTag) + ':' + base64(ciphertext)
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a ciphertext string
 *
 * @param ciphertext - Base64-encoded ciphertext in format: iv:authTag:ciphertext
 * @returns The decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();

  // Parse the ciphertext
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  // Validate lengths
  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Generate a new encryption key
 * Useful for initial setup
 *
 * @returns A new 32-byte key encoded as base64
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Clear the cached encryption key
 * Useful for testing or key rotation
 */
export function clearEncryptionKeyCache(): void {
  encryptionKey = null;
}
