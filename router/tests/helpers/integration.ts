import { exec } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';

const execAsync = promisify(exec);

/**
 * Integration test environment
 */
export class IntegrationTestEnvironment {
  private redis?: Redis;

  /**
   * Start test infrastructure (Docker containers)
   */
  async setup(): Promise<void> {
    console.log('Starting test infrastructure...');

    // Start test containers
    await execAsync('docker compose -f docker-compose.test.yml up -d');

    // Wait for Redis to be healthy
    await this.waitForRedis();

    console.log('Test infrastructure ready');
  }

  /**
   * Clean up test infrastructure
   */
  async teardown(): Promise<void> {
    console.log('Cleaning up test infrastructure...');

    // Disconnect Redis
    if (this.redis) {
      await this.redis.quit();
    }

    // Stop test containers
    await execAsync('docker compose -f docker-compose.test.yml down -v');

    console.log('Test infrastructure cleaned up');
  }

  /**
   * Get Redis client for testing
   */
  getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis({
        host: 'localhost',
        port: 6380,
        db: 15,
      });
    }
    return this.redis;
  }

  /**
   * Clear Redis test database
   */
  async clearRedis(): Promise<void> {
    const redis = this.getRedis();
    await redis.flushdb();
  }

  /**
   * Wait for Redis to be ready
   */
  private async waitForRedis(timeout = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const redis = new Redis({
          host: 'localhost',
          port: 6380,
          lazyConnect: true,
        });
        await redis.connect();
        await redis.ping();
        await redis.quit();
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error('Redis did not become ready within timeout');
  }
}

/**
 * Create a test environment instance
 */
export function createTestEnvironment(): IntegrationTestEnvironment {
  return new IntegrationTestEnvironment();
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info');
    return true;
  } catch {
    return false;
  }
}

/**
 * Skip integration tests if Docker is not available
 *
 * Usage in test files:
 * ```
 * describe('My Integration Test', () => {
 *   skipIfNoDocker();
 *
 *   // ... rest of tests
 * });
 * ```
 *
 * Note: If Docker is not available, tests will fail with a clear message
 * rather than being skipped, as Jest doesn't support dynamic test skipping
 * in the same way as Mocha. To truly skip integration tests, run:
 * `npm test -- --testPathIgnorePatterns="integration"`
 */
export function skipIfNoDocker(): void {
  let dockerAvailable = true;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.warn('\n⚠️  Docker not available - integration tests will fail');
      console.warn('   To run integration tests: install Docker and ensure it is running');
      console.warn('   To skip integration tests: npm test -- --testPathIgnorePatterns="integration"\n');
    }
  }, 10000);

  beforeEach(() => {
    if (!dockerAvailable) {
      throw new Error(
        'Docker not available. Integration tests require Docker to be installed and running. ' +
        'To skip these tests, run: npm test -- --testPathIgnorePatterns="integration"'
      );
    }
  });
}
