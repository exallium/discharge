/**
 * Next.js Instrumentation
 *
 * This file runs when the Next.js server starts.
 * Used to initialize database, run migrations, and register services.
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Initialize database first
    const { initializeDatabase } = await import('./src/db');
    await initializeDatabase();

    // Initialize services (triggers, runners, VCS plugins)
    const { initializeServices } = await import('./src/config/services');
    await initializeServices();
  }
}
