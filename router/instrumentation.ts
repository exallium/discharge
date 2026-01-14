/**
 * Next.js Instrumentation
 *
 * This file runs when the Next.js server starts.
 * Used to initialize database and run migrations.
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeDatabase } = await import('./src/db');
    await initializeDatabase();
  }
}
