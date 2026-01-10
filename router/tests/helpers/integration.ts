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
 * Skip integration tests if Docker is not available
 */
export function skipIfNoDocker(): void {
  beforeAll(async () => {
    try {
      await execAsync('docker info');
    } catch {
      console.log('Docker not available, skipping integration tests');
      // Skip all tests in this suite
      (global as any).testSkipped = true;
    }
  });

  beforeEach(function(this: any) {
    if ((global as any).testSkipped) {
      this.skip();
    }
  });
}
