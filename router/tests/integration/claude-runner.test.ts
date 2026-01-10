import { isDockerAvailable, isClaudeRunnerImageAvailable } from '../../src/runner/claude';
import { skipIfNoDocker } from '../helpers/integration';

describe('Claude Runner Integration', () => {
  skipIfNoDocker();

  describe('isDockerAvailable', () => {
    it('should detect Docker availability', async () => {
      const available = await isDockerAvailable();
      expect(available).toBe(true);
    });
  });

  describe('isClaudeRunnerImageAvailable', () => {
    it('should check for claude-runner image', async () => {
      const available = await isClaudeRunnerImageAvailable();

      // This might be false in CI if image isn't built
      expect(typeof available).toBe('boolean');
    });
  });

  // Note: We don't test actual container execution here because:
  // 1. It requires Claude authentication
  // 2. It's slow (git clone, docker run)
  // 3. It's expensive (API calls)
  //
  // The orchestrator integration test covers this with mocks
});
