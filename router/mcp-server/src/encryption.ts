/**
 * Encryption utilities for decrypting secrets from the database
 *
 * Uses AES-256-GCM - same as the main router application.
 * This is a read-only version that only supports decryption.
 */

import { createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

// Cached encryption key
let encryptionKey: Buffer | null = null;

/**
 * Get the encryption key from environment
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
      `DB_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes when decoded from base64. ` +
        `Got ${key.length} bytes.`
    );
  }

  encryptionKey = key;
  return key;
}

/**
 * Check if decryption is available
 */
export function isDecryptionAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Decrypt a ciphertext string
 *
 * @param ciphertext - Base64-encoded ciphertext in format: iv:authTag:ciphertext
 * @returns The decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = Buffer.from(parts[2], 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
