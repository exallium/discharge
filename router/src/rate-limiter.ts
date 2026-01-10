import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from './logger';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
}

/**
 * Create rate limiter middleware
 */
function createRateLimiter(config: RateLimitConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: { error: config.message },
    skipSuccessfulRequests: config.skipSuccessfulRequests,
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers

    // Custom handler for rate limit exceeded
    handler: (req: Request, res: Response) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });
      res.status(429).json({
        error: config.message,
        retryAfter: res.getHeader('Retry-After'),
      });
    },

    // Skip rate limiting for certain IPs (e.g., localhost in development)
    skip: (req: Request) => {
      // Skip rate limiting in test environment
      if (process.env.NODE_ENV === 'test') {
        return true;
      }

      // Skip rate limiting for localhost in development
      if (process.env.NODE_ENV === 'development' && req.ip === '127.0.0.1') {
        return true;
      }

      return false;
    },
  });
}

/**
 * Rate limiter for webhook endpoints
 * More restrictive to prevent abuse
 */
export const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_WEBHOOK || '60'), // 60 requests per minute by default
  message: 'Too many webhook requests from this IP, please try again later',
  skipSuccessfulRequests: false,
});

/**
 * Rate limiter for general API endpoints
 * More lenient for normal operations
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_API || '100'), // 100 requests per minute by default
  message: 'Too many requests from this IP, please try again later',
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * Strict rate limiter for authentication or sensitive endpoints
 */
export const strictRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 minutes
  message: 'Too many attempts from this IP, please try again later',
  skipSuccessfulRequests: false,
});

/**
 * Rate limiter for health check endpoints
 * Very lenient to allow monitoring tools
 */
export const healthCheckRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute (5 per second)
  message: 'Too many health check requests',
  skipSuccessfulRequests: true,
});
