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

    // Auto-complete setup if ADMIN_PASSWORD is set and no DB password exists
    if (process.env.ADMIN_PASSWORD) {
      const { settingsRepo } = await import('./src/db/repositories');
      const dbPassword = await settingsRepo.get('admin:password');
      if (!dbPassword) {
        const bcrypt = await import('bcrypt');
        const username = process.env.ADMIN_USERNAME || 'admin';
        const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
        await settingsRepo.set('admin:username', username);
        await settingsRepo.set('admin:password', hashedPassword);
        console.log(`✓ Admin account configured from environment (username: ${username})`);
      }
    }

    // Initialize services (triggers, runners, VCS plugins)
    const { initializeServices } = await import('./src/config/services');
    await initializeServices();
  }
}
