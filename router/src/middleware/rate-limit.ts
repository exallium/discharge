/**
 * Simple in-memory rate limiter for Next.js App Router endpoints.
 *
 * Tracks requests by IP address. Not shared across instances —
 * for a single-server deployment like Discharge, this is sufficient.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;  // Time window in milliseconds
  max: number;       // Max requests per window
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

/**
 * Create a rate limiter that can be called from route handlers.
 *
 * Returns { limited: true, retryAfterMs } if the IP has exceeded the limit,
 * or { limited: false } if the request is allowed.
 */
export function createRateLimiter(name: string, options: RateLimiterOptions) {
  const store = new Map<string, RateLimitEntry>();
  stores.set(name, store);

  // Periodically clean up expired entries
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }, options.windowMs).unref();

  return function check(ip: string): { limited: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + options.windowMs });
      return { limited: false };
    }

    entry.count++;
    if (entry.count > options.max) {
      return { limited: true, retryAfterMs: entry.resetAt - now };
    }

    return { limited: false };
  };
}

/**
 * Pre-built limiter for authentication endpoints.
 * 5 attempts per 15 minutes per IP.
 */
export const authRateLimiter = createRateLimiter('auth', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
});
