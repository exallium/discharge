/**
 * Tests for Workspace Manager
 *
 * Verifies that git workspaces (bare repos with worktrees) are managed correctly.
 */

// Mock dependencies before importing the module
const mockExecAsync = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });

jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => mockExecAsync),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  stat: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/vcs', () => ({
  getGitHubToken: jest.fn().mockResolvedValue('ghp_test_token'),
}));

// Now import the module and fs/promises
import {
  getOrCreateRepo,
  createWorktree,
  removeWorktree,
  updateWorktreeStatus,
  cleanupStaleWorktrees,
  getWorktreeInfo,
  listWorktrees,
  getWorkspaceRoot,
} from '../../../src/runner/workspace';

import { mkdir, rm, readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';

describe('Workspace Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  describe('getWorkspaceRoot', () => {
    it('should return the configured workspace root', () => {
      const root = getWorkspaceRoot();
      expect(typeof root).toBe('string');
      expect(root).toBe('/workspaces');
    });
  });

  describe('getOrCreateRepo', () => {
    it('should clone new bare repository when it does not exist', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      await getOrCreateRepo('project-123', 'https://github.com/test/repo.git');

      expect(mkdir).toHaveBeenCalled();
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git clone --bare'),
        expect.any(Object)
      );
    });

    it('should inject token into GitHub HTTPS URL', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      await getOrCreateRepo('project-123', 'https://github.com/test/repo.git');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('x-access-token:ghp_test_token@github.com'),
        expect.any(Object)
      );
    });

    it('should fetch updates when repo already exists', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      mockExecAsync.mockResolvedValueOnce({ stdout: 'https://github.com/test/repo.git\n', stderr: '' });

      await getOrCreateRepo('project-123', 'https://github.com/test/repo.git');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git remote get-url origin'),
        expect.any(Object)
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git fetch --all --prune'),
        expect.any(Object)
      );
    });

    it('should throw error if clone fails', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);
      mockExecAsync.mockRejectedValueOnce(new Error('Clone failed: permission denied'));

      await expect(
        getOrCreateRepo('project-123', 'https://github.com/test/repo.git')
      ).rejects.toThrow('Clone failed');
    });
  });

  describe('createWorktree', () => {
    beforeEach(() => {
      (existsSync as jest.Mock).mockReturnValue(true);
      mockExecAsync
        .mockResolvedValueOnce({ stdout: 'https://github.com/test/repo.git\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });
    });

    it('should create worktree from specified branch', async () => {
      const path = await createWorktree(
        'project-123',
        'job-abc',
        'main',
        'https://github.com/test/repo.git'
      );

      expect(path).toContain('job-abc');
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git worktree add'),
        expect.any(Object)
      );
    });

    it('should write worktree metadata file', async () => {
      await createWorktree(
        'project-123',
        'job-abc',
        'main',
        'https://github.com/test/repo.git'
      );

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.meta'),
        expect.stringContaining('"status": "active"')
      );
    });

    it('should create fix branch for the job', async () => {
      await createWorktree(
        'project-123',
        'job-abc123',
        'main',
        'https://github.com/test/repo.git'
      );

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git checkout -b'),
        expect.any(Object)
      );
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree via git and delete directory', async () => {
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      await removeWorktree('project-123', 'job-abc');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        expect.any(Object)
      );
      expect(rm).toHaveBeenCalled();
    });

    it('should handle already removed worktree gracefully', async () => {
      mockExecAsync.mockRejectedValueOnce(new Error('Worktree not found'));
      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        removeWorktree('project-123', 'job-abc')
      ).resolves.not.toThrow();
    });

    it('should prune orphaned worktree references', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      await removeWorktree('project-123', 'job-abc');

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('git worktree prune'),
        expect.any(Object)
      );
    });
  });

  describe('updateWorktreeStatus', () => {
    it('should update status in metadata file', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        createdAt: '2024-01-01T00:00:00Z',
        branch: 'fix/test',
        jobId: 'job-123',
        status: 'active',
      }));

      await updateWorktreeStatus('project-123', 'job-123', 'completed');

      expect(writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"status": "completed"')
      );
    });

    it('should handle missing metadata file gracefully', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        updateWorktreeStatus('project-123', 'job-123', 'completed')
      ).resolves.not.toThrow();
    });
  });

  describe('cleanupStaleWorktrees', () => {
    it('should remove worktrees older than TTL', async () => {
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      (readdir as jest.Mock)
        .mockResolvedValueOnce(['project-1'])
        .mockResolvedValueOnce(['old-job.meta']);

      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        createdAt: oldDate,
        branch: 'fix/old',
        jobId: 'old-job',
        status: 'active',
      }));

      const removed = await cleanupStaleWorktrees(24);

      expect(removed).toBe(1);
    });

    it('should not remove active worktrees within TTL', async () => {
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);

      (readdir as jest.Mock)
        .mockResolvedValueOnce(['project-1'])
        .mockResolvedValueOnce(['new-job.meta']);

      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        createdAt: recentDate,
        branch: 'fix/new',
        jobId: 'new-job',
        status: 'active',
      }));

      const removed = await cleanupStaleWorktrees(24);

      expect(removed).toBe(0);
    });

    it('should remove completed worktrees regardless of age', async () => {
      (existsSync as jest.Mock)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      (readdir as jest.Mock)
        .mockResolvedValueOnce(['project-1'])
        .mockResolvedValueOnce(['completed-job.meta']);

      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        createdAt: recentDate,
        branch: 'fix/done',
        jobId: 'completed-job',
        status: 'completed',
      }));

      const removed = await cleanupStaleWorktrees(24);

      expect(removed).toBe(1);
    });

    it('should return 0 when workspace root does not exist', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      const removed = await cleanupStaleWorktrees();

      expect(removed).toBe(0);
    });
  });

  describe('getWorktreeInfo', () => {
    it('should return worktree metadata', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({
        createdAt: '2024-01-01T00:00:00Z',
        branch: 'fix/test',
        jobId: 'job-123',
        status: 'active',
      }));

      const info = await getWorktreeInfo('project-123', 'job-123');

      expect(info).toEqual({
        createdAt: '2024-01-01T00:00:00Z',
        branch: 'fix/test',
        jobId: 'job-123',
        status: 'active',
      });
    });

    it('should return null for non-existent worktree', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      const info = await getWorktreeInfo('project-123', 'nonexistent');

      expect(info).toBeNull();
    });
  });

  describe('listWorktrees', () => {
    it('should return all worktrees for a project', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readdir as jest.Mock).mockResolvedValue(['job-1.meta', 'job-2.meta', 'job-1']);

      (readFile as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          createdAt: '2024-01-01T00:00:00Z',
          branch: 'fix/one',
          jobId: 'job-1',
          status: 'active',
        }))
        .mockResolvedValueOnce(JSON.stringify({
          createdAt: '2024-01-02T00:00:00Z',
          branch: 'fix/two',
          jobId: 'job-2',
          status: 'completed',
        }));

      const worktrees = await listWorktrees('project-123');

      expect(worktrees).toHaveLength(2);
      expect(worktrees[0].jobId).toBe('job-1');
      expect(worktrees[1].jobId).toBe('job-2');
    });

    it('should return empty array when worktrees directory does not exist', async () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      const worktrees = await listWorktrees('project-123');

      expect(worktrees).toEqual([]);
    });

    it('should skip invalid metadata files', async () => {
      (existsSync as jest.Mock).mockReturnValue(true);
      (readdir as jest.Mock).mockResolvedValue(['valid.meta', 'invalid.meta']);

      (readFile as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          createdAt: '2024-01-01T00:00:00Z',
          branch: 'fix/valid',
          jobId: 'valid',
          status: 'active',
        }))
        .mockRejectedValueOnce(new Error('Invalid JSON'));

      const worktrees = await listWorktrees('project-123');

      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].jobId).toBe('valid');
    });
  });
});
