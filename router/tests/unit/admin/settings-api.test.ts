/**
 * Tests for admin settings API
 */

import express from 'express';
import request from 'supertest';
import { settingsRouter } from '../../../src/admin/routes/settings';

// Mock the repositories
jest.mock('../../../src/db/repositories', () => ({
  settingsRepo: {
    getAll: jest.fn(),
    getByCategory: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
    hasPassword: jest.fn(),
    verifyPassword: jest.fn(),
    setPassword: jest.fn(),
    getCategories: jest.fn(),
  },
  auditLogRepo: {
    logSettingChange: jest.fn(),
    log: jest.fn(),
  },
}));

// Mock auth
jest.mock('../../../src/admin/auth', () => ({
  getAdminUser: jest.fn().mockReturnValue('admin'),
}));

// Mock settings schemas
jest.mock('../../../src/types/settings', () => ({
  getAllSettingsSchemas: jest.fn().mockReturnValue([
    {
      category: 'github',
      displayName: 'GitHub',
      settings: [
        { key: 'token', label: 'API Token', type: 'password', required: true, encrypted: true },
        { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', required: false },
      ],
    },
  ]),
  getSettingsSchema: jest.fn().mockImplementation((category) => {
    if (category === 'github') {
      return {
        category: 'github',
        displayName: 'GitHub',
        settings: [
          { key: 'token', label: 'API Token', type: 'password', required: true, encrypted: true },
        ],
      };
    }
    return undefined;
  }),
}));

import { settingsRepo, auditLogRepo } from '../../../src/db/repositories';

const mockSettingsRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;
const mockAuditLogRepo = auditLogRepo as jest.Mocked<typeof auditLogRepo>;

describe('Settings API', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/settings', settingsRouter);
  });

  describe('GET /api/settings/schema', () => {
    it('should return all settings schemas', async () => {
      const response = await request(app).get('/api/settings/schema');

      expect(response.status).toBe(200);
      expect(response.body.schemas).toHaveLength(1);
      expect(response.body.schemas[0].category).toBe('github');
    });
  });

  describe('GET /api/settings/schema/:category', () => {
    it('should return a specific schema', async () => {
      const response = await request(app).get('/api/settings/schema/github');

      expect(response.status).toBe(200);
      expect(response.body.schema.category).toBe('github');
    });

    it('should return 404 for unknown category', async () => {
      const response = await request(app).get('/api/settings/schema/unknown');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/settings', () => {
    it('should return all settings', async () => {
      mockSettingsRepo.getAll.mockResolvedValue({
        github: [
          { key: 'github.token', value: '********', encrypted: true, description: null, category: 'github', createdAt: new Date(), updatedAt: new Date() },
        ],
      });

      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(200);
      expect(response.body.settings).toBeDefined();
    });
  });

  describe('GET /api/settings/:category', () => {
    it('should return settings for a category', async () => {
      mockSettingsRepo.getByCategory.mockResolvedValue([
        { key: 'github.token', value: '********', encrypted: true, description: null, category: 'github', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const response = await request(app).get('/api/settings/github');

      expect(response.status).toBe(200);
      expect(response.body.category).toBe('github');
      expect(response.body.settings).toHaveLength(1);
    });
  });

  describe('PUT /api/settings/:category/:key', () => {
    it('should update a setting', async () => {
      mockSettingsRepo.get.mockResolvedValue(undefined);
      mockSettingsRepo.set.mockResolvedValue();

      const response = await request(app)
        .put('/api/settings/github/token')
        .send({ value: 'ghp_newtoken123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSettingsRepo.set).toHaveBeenCalledWith(
        'github.token',
        'ghp_newtoken123',
        expect.objectContaining({ encrypted: true })
      );
      expect(mockAuditLogRepo.logSettingChange).toHaveBeenCalled();
    });

    it('should return 400 when value is missing', async () => {
      const response = await request(app)
        .put('/api/settings/github/token')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('DELETE /api/settings/:category/:key', () => {
    it('should delete a setting', async () => {
      mockSettingsRepo.remove.mockResolvedValue(true);

      const response = await request(app).delete('/api/settings/github/token');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockAuditLogRepo.logSettingChange).toHaveBeenCalledWith(
        'delete',
        'github.token',
        expect.any(Object)
      );
    });

    it('should return 404 when setting does not exist', async () => {
      mockSettingsRepo.remove.mockResolvedValue(false);

      const response = await request(app).delete('/api/settings/github/nonexistent');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/settings/password', () => {
    it('should change password when current password is correct', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(true);
      mockSettingsRepo.verifyPassword.mockResolvedValue(true);
      mockSettingsRepo.setPassword.mockResolvedValue();

      const response = await request(app)
        .post('/api/settings/password')
        .send({
          currentPassword: 'oldpassword123',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockAuditLogRepo.log).toHaveBeenCalled();
    });

    it('should return 400 for short password', async () => {
      const response = await request(app)
        .post('/api/settings/password')
        .send({
          currentPassword: 'old',
          newPassword: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('12 characters');
    });

    it('should return 401 for wrong current password', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(true);
      mockSettingsRepo.verifyPassword.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/settings/password')
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(401);
    });

    it('should allow setting password without current when none exists', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(false);
      mockSettingsRepo.setPassword.mockResolvedValue();

      const response = await request(app)
        .post('/api/settings/password')
        .send({
          newPassword: 'newpassword123',
        });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/settings/categories', () => {
    it('should return all categories', async () => {
      mockSettingsRepo.getCategories.mockResolvedValue(['github', 'sentry', 'system']);

      const response = await request(app).get('/api/settings/categories');

      expect(response.status).toBe(200);
      expect(response.body.categories).toEqual(['github', 'sentry', 'system']);
    });
  });
});
