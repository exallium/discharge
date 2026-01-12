/**
 * Tests for admin projects API
 */

import express from 'express';
import request from 'supertest';
import { projectsRouter } from '../../../src/admin/routes/projects';

// Mock the repositories
jest.mock('../../../src/db/repositories', () => ({
  projectsRepo: {
    findAll: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setEnabled: jest.fn(),
  },
  auditLogRepo: {
    logProjectChange: jest.fn(),
  },
}));

// Mock auth
jest.mock('../../../src/admin/auth', () => ({
  getAdminUser: jest.fn().mockReturnValue('admin'),
}));

import { projectsRepo, auditLogRepo } from '../../../src/db/repositories';

const mockProjectsRepo = projectsRepo as jest.Mocked<typeof projectsRepo>;
const mockAuditLogRepo = auditLogRepo as jest.Mocked<typeof auditLogRepo>;

describe('Projects API', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/projects', projectsRouter);
  });

  describe('GET /api/projects', () => {
    it('should return all projects', async () => {
      const mockProjects = [
        {
          id: 'project-1',
          repo: 'https://github.com/test/repo1.git',
          repoFullName: 'test/repo1',
          branch: 'main',
          vcs: { type: 'github' as const, owner: 'test', repo: 'repo1' },
          triggers: {},
          enabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockProjectsRepo.findAll.mockResolvedValue(mockProjects);

      const response = await request(app).get('/api/projects');

      expect(response.status).toBe(200);
      expect(response.body.projects).toHaveLength(1);
      expect(response.body.projects[0].id).toBe('project-1');
      expect(mockProjectsRepo.findAll).toHaveBeenCalledWith(false);
    });

    it('should include disabled projects when requested', async () => {
      mockProjectsRepo.findAll.mockResolvedValue([]);

      await request(app).get('/api/projects?includeDisabled=true');

      expect(mockProjectsRepo.findAll).toHaveBeenCalledWith(true);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('should return a project by ID', async () => {
      const mockProject = {
        id: 'project-1',
        repo: 'https://github.com/test/repo1.git',
        repoFullName: 'test/repo1',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'test', repo: 'repo1' },
        triggers: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectsRepo.findById.mockResolvedValue(mockProject);

      const response = await request(app).get('/api/projects/project-1');

      expect(response.status).toBe(200);
      expect(response.body.project.id).toBe('project-1');
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectsRepo.findById.mockResolvedValue(undefined);

      const response = await request(app).get('/api/projects/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Project not found');
    });
  });

  describe('POST /api/projects', () => {
    it('should create a new project', async () => {
      const newProject = {
        id: 'new-project',
        repo: 'https://github.com/test/new.git',
        repoFullName: 'test/new',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'test', repo: 'new' },
      };

      mockProjectsRepo.findById.mockResolvedValue(undefined);
      mockProjectsRepo.create.mockResolvedValue({
        ...newProject,
        triggers: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/projects')
        .send(newProject);

      expect(response.status).toBe(201);
      expect(response.body.project.id).toBe('new-project');
      expect(mockAuditLogRepo.logProjectChange).toHaveBeenCalledWith(
        'create',
        'new-project',
        expect.any(Object)
      );
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/projects')
        .send({ id: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 409 for duplicate project ID', async () => {
      mockProjectsRepo.findById.mockResolvedValue({
        id: 'existing',
        repo: 'https://github.com/test/existing.git',
        repoFullName: 'test/existing',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'test', repo: 'existing' },
        triggers: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await request(app)
        .post('/api/projects')
        .send({
          id: 'existing',
          repo: 'https://github.com/test/new.git',
          repoFullName: 'test/new',
          vcs: { type: 'github' as const, owner: 'test', repo: 'new' },
        });

      expect(response.status).toBe(409);
    });
  });

  describe('PUT /api/projects/:id', () => {
    it('should update an existing project', async () => {
      const existingProject = {
        id: 'project-1',
        repo: 'https://github.com/test/repo1.git',
        repoFullName: 'test/repo1',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'test', repo: 'repo1' },
        triggers: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectsRepo.findById.mockResolvedValue(existingProject);
      mockProjectsRepo.update.mockResolvedValue({
        ...existingProject,
        branch: 'develop',
      });

      const response = await request(app)
        .put('/api/projects/project-1')
        .send({ branch: 'develop' });

      expect(response.status).toBe(200);
      expect(mockAuditLogRepo.logProjectChange).toHaveBeenCalledWith(
        'update',
        'project-1',
        expect.any(Object)
      );
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectsRepo.findById.mockResolvedValue(undefined);

      const response = await request(app)
        .put('/api/projects/non-existent')
        .send({ branch: 'develop' });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete an existing project', async () => {
      const existingProject = {
        id: 'project-1',
        repo: 'https://github.com/test/repo1.git',
        repoFullName: 'test/repo1',
        branch: 'main',
        vcs: { type: 'github' as const, owner: 'test', repo: 'repo1' },
        triggers: {},
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockProjectsRepo.findById.mockResolvedValue(existingProject);
      mockProjectsRepo.remove.mockResolvedValue(true);

      const response = await request(app).delete('/api/projects/project-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockAuditLogRepo.logProjectChange).toHaveBeenCalledWith(
        'delete',
        'project-1',
        expect.any(Object)
      );
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectsRepo.findById.mockResolvedValue(undefined);

      const response = await request(app).delete('/api/projects/non-existent');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/projects/:id/toggle', () => {
    it('should enable a project', async () => {
      mockProjectsRepo.setEnabled.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/projects/project-1/toggle')
        .send({ enabled: true });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
    });

    it('should disable a project', async () => {
      mockProjectsRepo.setEnabled.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/projects/project-1/toggle')
        .send({ enabled: false });

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return 400 for invalid enabled value', async () => {
      const response = await request(app)
        .post('/api/projects/project-1/toggle')
        .send({ enabled: 'yes' });

      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent project', async () => {
      mockProjectsRepo.setEnabled.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/projects/non-existent/toggle')
        .send({ enabled: true });

      expect(response.status).toBe(404);
    });
  });
});
