import { queueFixJob, getQueueStats, pauseQueue, resumeQueue, initializeQueue, closeQueue } from '../../../src/queue';
import { FixJobData } from '../../../src/queue/types';
import { createTestEnvironment, skipIfNoDocker } from '../../helpers/integration';

describe('Queue Integration', () => {
  const env = createTestEnvironment();

  skipIfNoDocker();

  beforeAll(async () => {
    await env.setup();

    // Initialize queue with test Redis
    process.env.REDIS_URL = 'redis://localhost:6380/15';
    await initializeQueue();
  }, 60000);

  afterAll(async () => {
    await closeQueue();
    await env.teardown();
  }, 30000);

  beforeEach(async () => {
    await env.clearRedis();
  });

  describe('queueFixJob', () => {
    it('should queue a fix job', async () => {
      const jobData: FixJobData = {
        event: {
          triggerType: 'mock',
          triggerId: 'test-123',
          projectId: 'test-project',
          title: 'Test Issue',
          description: 'Test description',
          metadata: {},
          raw: {},
        },
        triggerType: 'mock',
        queuedAt: new Date().toISOString(),
      };

      const jobId = await queueFixJob(jobData);

      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');
    });

    it('should queue job with custom options', async () => {
      const jobData: FixJobData = {
        event: {
          triggerType: 'mock',
          triggerId: 'test-456',
          projectId: 'test-project',
          title: 'Test Issue',
          description: 'Test description',
          metadata: {},
          raw: {},
        },
        triggerType: 'mock',
        queuedAt: new Date().toISOString(),
      };

      const jobId = await queueFixJob(jobData, {
        priority: 1,
        attempts: 5,
      });

      expect(jobId).toBeTruthy();
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await getQueueStats();

      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('delayed');
      expect(stats).toHaveProperty('paused');

      expect(typeof stats.waiting).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.paused).toBe('boolean');
    });
  });

  describe('pauseQueue and resumeQueue', () => {
    it('should pause and resume queue', async () => {
      // Pause
      await pauseQueue();
      let stats = await getQueueStats();
      expect(stats.paused).toBe(true);

      // Resume
      await resumeQueue();
      stats = await getQueueStats();
      expect(stats.paused).toBe(false);
    });
  });
});
