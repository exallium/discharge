/**
 * Tests for admin authentication
 */

import { Request, Response, NextFunction } from 'express';
import { adminAuth, requireAdminSetup, getAdminUser } from '../../../src/admin/auth';

// Mock the settings repository
jest.mock('../../../src/db/repositories', () => ({
  settingsRepo: {
    hasPassword: jest.fn(),
    verifyPassword: jest.fn(),
    get: jest.fn(),
  },
}));

import { settingsRepo } from '../../../src/db/repositories';

const mockSettingsRepo = settingsRepo as jest.Mocked<typeof settingsRepo>;

describe('Admin Authentication', () => {
  let mockReq: Partial<Request> & { path?: string };
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockReq = {
      headers: {},
      get: ((header: string) => {
        if (header.toLowerCase() === 'authorization') {
          return mockReq.headers?.authorization as string;
        }
        return undefined;
      }) as Request['get'],
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };

    mockNext = jest.fn();
  });

  describe('requireAdminSetup', () => {
    it('should call next() when admin password is set', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(true);

      await requireAdminSetup(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 503 when no admin password is set', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(false);
      delete process.env.ADMIN_PASSWORD;

      await requireAdminSetup(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Admin not configured',
        setupUrl: '/admin/setup',
      }));
      expect(mockNext).not.toHaveBeenCalled();

      // Restore env
      process.env.ADMIN_PASSWORD = 'testpassword123';
    });

    it('should allow access when env password is set', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(false);
      process.env.ADMIN_PASSWORD = 'testpassword123';

      await requireAdminSetup(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('adminAuth', () => {
    it('should return 401 when no authorization header is provided', async () => {
      mockSettingsRepo.hasPassword.mockResolvedValue(true);

      await adminAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Basic realm="AI Bug Fixer Admin"'
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid authorization format', async () => {
      mockReq.headers = { authorization: 'Bearer token123' };

      await adminAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 for invalid credentials', async () => {
      const credentials = Buffer.from('admin:wrongpassword').toString('base64');
      mockReq.headers = { authorization: `Basic ${credentials}` };

      mockSettingsRepo.hasPassword.mockResolvedValue(true);
      mockSettingsRepo.verifyPassword.mockResolvedValue(false);
      mockSettingsRepo.get.mockResolvedValue('admin');

      await adminAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() for valid credentials', async () => {
      const credentials = Buffer.from('admin:correctpassword').toString('base64');
      mockReq.headers = { authorization: `Basic ${credentials}` };

      mockSettingsRepo.hasPassword.mockResolvedValue(true);
      mockSettingsRepo.verifyPassword.mockResolvedValue(true);
      mockSettingsRepo.get.mockResolvedValue('admin');

      await adminAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should use environment credentials when no database credentials exist', async () => {
      const credentials = Buffer.from('admin:testpassword123').toString('base64');
      mockReq.headers = { authorization: `Basic ${credentials}` };

      mockSettingsRepo.get.mockResolvedValue(undefined);
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD = 'testpassword123';

      await adminAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getAdminUser', () => {
    it('should return the username stored on the request', () => {
      // Simulate what adminAuth does after successful authentication
      (mockReq as { adminUser?: string }).adminUser = 'testuser';

      const user = getAdminUser(mockReq as Request);

      expect(user).toBe('testuser');
    });

    it('should return undefined when no admin user set', () => {
      const user = getAdminUser(mockReq as Request);

      expect(user).toBeUndefined();
    });
  });
});
