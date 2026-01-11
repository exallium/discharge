import { exec } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import path from 'path';

const execAsync = promisify(exec);

// Path to repo root (one level up from router/)
const REPO_ROOT = path.resolve(__dirname, '../../../');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.test.yml');

/**
 * Integration test environment
 */
export class IntegrationTestEnvironment {
  private redis?: Redis;
  private setupComplete = false;

  /**
   * Start test infrastructure (Docker containers)
   */
  async setup(): Promise<void> {
    if (this.setupComplete) {
      return; // Already set up
    }

    console.log('Starting test infrastructure...');

    try {
      // Force recreate containers to avoid conflicts
      await execAsync(
        `docker compose -f "${COMPOSE_FILE}" up -d --force-recreate --remove-orphans`,
        { cwd: REPO_ROOT }
      );
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Failed to start containers:', err.message);
      throw error;
    }

    // Wait for Redis to be healthy
    await this.waitForRedis();

    this.setupComplete = true;
    console.log('Test infrastructure ready');
  }

  /**
   * Clean up test infrastructure
   */
  async teardown(): Promise<void> {
    console.log('Cleaning up test infrastructure...');

    // Disconnect Redis
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        // Ignore errors during cleanup
      }
      this.redis = undefined;
    }

    // Stop test containers
    try {
      await execAsync(
        `docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans`,
        { cwd: REPO_ROOT }
      );
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Failed to stop containers:', err.message);
    }

    this.setupComplete = false;
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
    // Ensure we're on the test DB
    await redis.select(15);
    await redis.flushdb();
  }

  /**
   * Wait for Redis to be ready
   */
  private async waitForRedis(timeout = 30000): Promise<void> {
    const start = Date.now();
    let lastError: Error | undefined;

    while (Date.now() - start < timeout) {
      try {
        const redis = new Redis({
          host: 'localhost',
          port: 6380,
          lazyConnect: true,
          connectTimeout: 5000,
        });
        await redis.connect();
        await redis.ping();
        await redis.quit();
        return;
      } catch (error: unknown) {
        lastError = error as Error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`Redis did not become ready within timeout: ${lastError?.message}`);
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
