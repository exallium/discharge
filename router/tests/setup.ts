/**
 * Jest setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Random port for testing
process.env.REDIS_URL = 'redis://localhost:6380/15'; // Use test Redis on port 6380, DB 15

// Database test environment (uses test postgres on port 5433)
process.env.DATABASE_URL = 'postgres://test:testpassword@localhost:5433/ai_bug_fixer_test';

// Generate a test encryption key (32 bytes base64 encoded)
process.env.DB_ENCRYPTION_KEY = 'Uc0kuiwlHzok1WaeFNBZoLlO42uUmBdkjQfG/W+5We8=';

// Test admin credentials
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'testpassword123';

// Increase timeout for integration tests
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for actual errors
  error: console.error,
};
