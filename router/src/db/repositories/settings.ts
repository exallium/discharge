/**
 * Settings repository - CRUD operations for global configuration
 *
 * Handles encrypted secrets with AES-256-GCM and password hashing with bcrypt.
 */

import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { getDatabase, settings, NewSetting } from '../index';
import { encrypt, decrypt, isEncryptionAvailable } from '../encryption';
import { logger } from '../../logger';

const BCRYPT_ROUNDS = 12;
const PASSWORD_SETTING_SUFFIX = '.password_hash';

/**
 * Setting with decrypted value
 */
export interface SettingValue {
  key: string;
  value: string;
  encrypted: boolean;
  description: string | null;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get a setting by key
 * Returns the raw value (encrypted values remain encrypted)
 */
export async function get(key: string): Promise<string | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  return result[0]?.value;
}

/**
 * Get a setting and decrypt if encrypted
 */
export async function getDecrypted(key: string): Promise<string | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (!result[0]) return undefined;

  if (result[0].encrypted) {
    try {
      return decrypt(result[0].value);
    } catch (error) {
      logger.error('Failed to decrypt setting', { key, error });
      throw new Error(`Failed to decrypt setting: ${key}`);
    }
  }

  return result[0].value;
}

/**
 * Get full setting details
 */
export async function getWithDetails(key: string): Promise<SettingValue | undefined> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (!result[0]) return undefined;

  return {
    key: result[0].key,
    value: result[0].encrypted ? '********' : result[0].value, // Mask encrypted values
    encrypted: result[0].encrypted,
    description: result[0].description,
    category: result[0].category,
    createdAt: result[0].createdAt,
    updatedAt: result[0].updatedAt,
  };
}

/**
 * Set a setting value
 */
export async function set(
  key: string,
  value: string,
  options?: {
    encrypted?: boolean;
    description?: string;
    category?: string;
  }
): Promise<void> {
  const db = getDatabase();
  const shouldEncrypt = options?.encrypted ?? false;

  // Encrypt if requested
  let storedValue = value;
  if (shouldEncrypt) {
    if (!isEncryptionAvailable()) {
      throw new Error('Encryption key not configured - cannot store encrypted settings');
    }
    storedValue = encrypt(value);
  }

  const setting: NewSetting = {
    key,
    value: storedValue,
    encrypted: shouldEncrypt,
    description: options?.description ?? null,
    category: options?.category ?? 'general',
  };

  // Upsert - insert or update on conflict
  await db
    .insert(settings)
    .values(setting)
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: storedValue,
        encrypted: shouldEncrypt,
        description: options?.description ?? null,
        category: options?.category ?? null,
        updatedAt: new Date(),
      },
    });

  logger.info('Setting updated', { key, encrypted: shouldEncrypt });
}

/**
 * Set a password (stores bcrypt hash)
 */
export async function setPassword(
  key: string,
  password: string,
  options?: {
    description?: string;
    category?: string;
  }
): Promise<void> {
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await set(`${key}${PASSWORD_SETTING_SUFFIX}`, hash, {
    encrypted: false, // Hash doesn't need encryption
    description: options?.description ?? 'Hashed password',
    category: options?.category ?? 'auth',
  });

  logger.info('Password hash stored', { key });
}

/**
 * Verify a password against stored hash
 */
export async function verifyPassword(key: string, password: string): Promise<boolean> {
  const hash = await get(`${key}${PASSWORD_SETTING_SUFFIX}`);
  if (!hash) return false;

  return bcrypt.compare(password, hash);
}

/**
 * Check if a password exists
 */
export async function hasPassword(key: string): Promise<boolean> {
  const hash = await get(`${key}${PASSWORD_SETTING_SUFFIX}`);
  return !!hash;
}

/**
 * Delete a setting
 */
export async function remove(key: string): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .delete(settings)
    .where(eq(settings.key, key))
    .returning({ key: settings.key });

  if (result.length > 0) {
    logger.info('Setting deleted', { key });
    return true;
  }

  return false;
}

/**
 * Get all settings in a category
 * Encrypted values are masked
 */
export async function getByCategory(category: string): Promise<SettingValue[]> {
  const db = getDatabase();

  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.category, category));

  return result.map((row) => ({
    key: row.key,
    value: row.encrypted ? '********' : row.value,
    encrypted: row.encrypted,
    description: row.description,
    category: row.category,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Get all settings grouped by category
 * Encrypted values are masked
 */
export async function getAll(): Promise<Record<string, SettingValue[]>> {
  const db = getDatabase();
  const result = await db.select().from(settings);

  const grouped: Record<string, SettingValue[]> = {};

  for (const row of result) {
    const category = row.category ?? 'general';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push({
      key: row.key,
      value: row.encrypted ? '********' : row.value,
      encrypted: row.encrypted,
      description: row.description,
      category: row.category,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  return grouped;
}

/**
 * Get all categories
 */
export async function getCategories(): Promise<string[]> {
  const db = getDatabase();
  const result = await db
    .selectDistinct({ category: settings.category })
    .from(settings);

  return result
    .map((row) => row.category)
    .filter((c): c is string => c !== null);
}

/**
 * Check if any settings exist (for first-run detection)
 */
export async function hasAnySettings(): Promise<boolean> {
  const db = getDatabase();
  const result = await db.select().from(settings).limit(1);
  return result.length > 0;
}

/**
 * Initialize admin credentials from environment variable
 * Only used during first-run setup
 */
export async function initializeAdminFromEnv(): Promise<boolean> {
  // Check if admin password already exists using the same key as auth.ts
  const existingPassword = await get('admin:password');
  if (existingPassword) {
    return false; // Already initialized
  }

  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envPassword) {
    logger.warn('No ADMIN_PASSWORD in environment, admin UI will be inaccessible until set');
    return false;
  }

  const username = process.env.ADMIN_USERNAME ?? 'admin';

  // Use the same keys as auth.ts and setup/route.ts
  await set('admin:username', username, {
    description: 'Admin UI username',
    category: 'auth',
  });

  // Hash and store password directly (same as setup/route.ts)
  const hashedPassword = await bcrypt.hash(envPassword, BCRYPT_ROUNDS);
  await set('admin:password', hashedPassword, {
    description: 'Admin UI password hash',
    category: 'auth',
  });

  logger.info('Admin credentials initialized from environment');
  return true;
}
