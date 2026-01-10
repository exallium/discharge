import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
 * Check if a Docker container is running
 */
export async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`docker ps --filter "name=${name}" --format "{{.Names}}"`);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

/**
 * Wait for a container to be healthy
 */
export async function waitForContainer(
  name: string,
  timeout = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const { stdout } = await execAsync(
        `docker inspect --format='{{.State.Health.Status}}' ${name}`
      );
      if (stdout.trim() === 'healthy') {
        return;
      }
    } catch {
      // Container might not exist yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Container ${name} did not become healthy within ${timeout}ms`);
}

/**
 * Execute a command in a running container
 */
export async function execInContainer(
  containerName: string,
  command: string
): Promise<string> {
  const { stdout } = await execAsync(`docker exec ${containerName} ${command}`);
  return stdout.trim();
}

/**
 * Get container logs
 */
export async function getContainerLogs(
  containerName: string,
  tail = 100
): Promise<string> {
  const { stdout } = await execAsync(`docker logs --tail ${tail} ${containerName}`);
  return stdout;
}
