/**
 * Admin authentication middleware
 *
 * Supports Basic HTTP authentication with credentials stored in database
 * (bcrypt hashed) or from environment variables as fallback.
 */

import { Request, Response, NextFunction } from 'express';
import { settingsRepo } from '../db/repositories';
import { logger } from '../logger';

/**
 * Admin authentication middleware
 * Verifies Basic auth credentials against database or environment
 */
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    sendAuthRequired(res);
    return;
  }

  // Parse Basic auth header
  if (!authHeader.startsWith('Basic ')) {
    sendAuthRequired(res, 'Invalid authorization scheme');
    return;
  }

  const base64Credentials = authHeader.slice(6);
  let credentials: string;

  try {
    credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
  } catch {
    sendAuthRequired(res, 'Invalid authorization header');
    return;
  }

  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) {
    sendAuthRequired(res, 'Invalid credentials format');
    return;
  }

  const username = credentials.slice(0, colonIndex);
  const password = credentials.slice(colonIndex + 1);

  // Verify credentials
  const isValid = await verifyCredentials(username, password);

  if (!isValid) {
    logger.warn('Admin authentication failed', {
      username,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    sendAuthRequired(res, 'Invalid credentials');
    return;
  }

  // Store authenticated user info in request
  (req as AuthenticatedRequest).adminUser = username;

  logger.debug('Admin authentication successful', { username });
  next();
}

/**
 * Verify username and password
 * First tries database, falls back to environment variables
 */
async function verifyCredentials(username: string, password: string): Promise<boolean> {
  try {
    // First, try to verify against database
    const dbUsername = await settingsRepo.get('admin.username');

    if (dbUsername) {
      // Database credentials exist
      if (username !== dbUsername) {
        return false;
      }
      return settingsRepo.verifyPassword('admin', password);
    }

    // Fall back to environment variables
    const envUsername = process.env.ADMIN_USERNAME ?? 'admin';
    const envPassword = process.env.ADMIN_PASSWORD;

    if (!envPassword) {
      logger.warn('No admin credentials configured (database or environment)');
      return false;
    }

    return username === envUsername && password === envPassword;
  } catch (error) {
    logger.error('Error verifying admin credentials', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Send 401 Unauthorized response with WWW-Authenticate header
 */
function sendAuthRequired(res: Response, message?: string): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="AI Bug Fixer Admin"');
  res.status(401).json({
    error: 'Authentication required',
    message: message || 'Please provide valid credentials',
  });
}

/**
 * Extended request with admin user info
 */
export interface AuthenticatedRequest extends Request {
  adminUser?: string;
}

/**
 * Helper to get admin username from request
 */
export function getAdminUser(req: Request): string | undefined {
  return (req as AuthenticatedRequest).adminUser;
}

/**
 * Middleware to check if admin is configured
 * Returns 503 if no admin credentials are set up
 */
export async function requireAdminSetup(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const hasDbPassword = await settingsRepo.hasPassword('admin');
  const hasEnvPassword = !!process.env.ADMIN_PASSWORD;

  if (!hasDbPassword && !hasEnvPassword) {
    res.status(503).json({
      error: 'Admin not configured',
      message: 'Please set ADMIN_PASSWORD environment variable or complete setup wizard',
      setupUrl: '/admin/setup',
    });
    return;
  }

  next();
}
