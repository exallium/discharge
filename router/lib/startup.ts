import { randomBytes } from 'crypto';

/**
 * Generated admin password for first-run scenarios
 * This is generated once on startup and cached in memory
 */
let generatedPassword: string | null = null;
let hasLoggedPassword = false;

/**
 * Generate a random password for first-run
 */
function generateRandomPassword(): string {
  return randomBytes(12).toString('base64').replace(/[/+=]/g, '').slice(0, 12);
}

/**
 * Get the generated password (creates one if needed)
 */
export function getGeneratedPassword(): string {
  if (!generatedPassword) {
    generatedPassword = generateRandomPassword();
  }
  return generatedPassword;
}

/**
 * Log the generated password to console (only once)
 */
export function logGeneratedPassword(): void {
  if (hasLoggedPassword) return;
  hasLoggedPassword = true;

  const password = getGeneratedPassword();

  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('  FIRST RUN - No admin password configured');
  console.log('');
  console.log(`  Generated temporary password: ${password}`);
  console.log('');
  console.log('  Use this to log in at /login, then set your own password.');
  console.log('  Username: admin');
  console.log('');
  console.log('  To skip this, set ADMIN_PASSWORD environment variable.');
  console.log('');
  console.log('='.repeat(60));
  console.log('');
}

/**
 * Clear the generated password (after user sets their own)
 */
export function clearGeneratedPassword(): void {
  generatedPassword = null;
  hasLoggedPassword = false;
}
