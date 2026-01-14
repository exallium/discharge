/**
 * TOTP (Time-based One-Time Password) utilities
 *
 * Provides TOTP generation, verification, and backup code management
 * using the otpauth library.
 */

import * as OTPAuth from 'otpauth';
import * as QRCode from 'qrcode';
import { randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { settingsRepo } from '@/src/db/repositories';

const ISSUER = 'AI Bug Fixer';
const BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 10;

/**
 * TOTP setup data returned when generating a new secret
 */
export interface TOTPSetupData {
  secret: string;
  uri: string;
  qrDataUrl: string;
}

/**
 * Generate a new TOTP secret and QR code
 */
export async function generateTotpSecret(label: string): Promise<TOTPSetupData> {
  const secret = new OTPAuth.Secret({ size: 20 });

  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  const uri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(uri);

  return {
    secret: secret.base32,
    uri,
    qrDataUrl,
  };
}

/**
 * Verify a TOTP code against a secret
 * Allows 1 period (30 seconds) of drift in each direction
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    // Allow 1 period drift (30 seconds each direction)
    const delta = totp.validate({ token: code, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

/**
 * Check if TOTP is enabled for the admin
 */
export async function isTotpEnabled(): Promise<boolean> {
  const enabled = await settingsRepo.get('totp:enabled');
  return enabled === 'true';
}

/**
 * Get the stored TOTP secret (decrypted)
 */
export async function getTotpSecret(): Promise<string | undefined> {
  return settingsRepo.getDecrypted('totp:secret');
}

/**
 * Generate backup codes
 * Returns plaintext codes (to show user once) and bcrypt hashes (to store)
 */
export async function generateBackupCodes(): Promise<{
  codes: string[];
  hashes: string[];
}> {
  const codes: string[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    // Generate 8-character hex code (e.g., "A1B2C3D4")
    const code = randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
    hashes.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }

  return { codes, hashes };
}

/**
 * Verify a backup code against stored hashes
 * Removes the code if valid (one-time use)
 */
export async function verifyBackupCode(inputCode: string): Promise<boolean> {
  const json = await settingsRepo.getDecrypted('totp:backup_codes');
  if (!json) return false;

  let hashes: string[];
  try {
    hashes = JSON.parse(json);
  } catch {
    return false;
  }

  const normalizedCode = inputCode.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalizedCode, hashes[i])) {
      // Remove used code
      hashes.splice(i, 1);
      await settingsRepo.set('totp:backup_codes', JSON.stringify(hashes), {
        encrypted: true,
        category: 'auth',
      });
      return true;
    }
  }

  return false;
}

/**
 * Get the count of remaining backup codes
 */
export async function getBackupCodeCount(): Promise<number> {
  const json = await settingsRepo.getDecrypted('totp:backup_codes');
  if (!json) return 0;

  try {
    const hashes = JSON.parse(json);
    return Array.isArray(hashes) ? hashes.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Save TOTP setup (secret and backup codes)
 */
export async function saveTotpSetup(
  secret: string,
  hashedBackupCodes: string[]
): Promise<void> {
  await settingsRepo.set('totp:secret', secret, {
    encrypted: true,
    description: 'TOTP secret for 2FA',
    category: 'auth',
  });

  await settingsRepo.set('totp:backup_codes', JSON.stringify(hashedBackupCodes), {
    encrypted: true,
    description: 'TOTP backup codes (hashed)',
    category: 'auth',
  });

  await settingsRepo.set('totp:enabled', 'true', {
    encrypted: false,
    description: 'TOTP 2FA enabled flag',
    category: 'auth',
  });
}

/**
 * Disable TOTP
 * Removes the secret and backup codes
 */
export async function disableTotp(): Promise<void> {
  await settingsRepo.set('totp:enabled', 'false', {
    encrypted: false,
    category: 'auth',
  });

  // Remove secret and backup codes
  await settingsRepo.remove('totp:secret');
  await settingsRepo.remove('totp:backup_codes');
}

/**
 * Regenerate backup codes (requires TOTP to be enabled)
 */
export async function regenerateBackupCodes(): Promise<string[]> {
  const enabled = await isTotpEnabled();
  if (!enabled) {
    throw new Error('TOTP is not enabled');
  }

  const { codes, hashes } = await generateBackupCodes();

  await settingsRepo.set('totp:backup_codes', JSON.stringify(hashes), {
    encrypted: true,
    category: 'auth',
  });

  return codes;
}
