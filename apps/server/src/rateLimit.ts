import type { RequestHandler } from 'express';
import { nanoid } from 'nanoid';
import { redis } from './lib/redis.js';
import { logger } from './lib/logger.js';

/**
 * Sliding-window rate limiter backed by a Redis sorted set. Survives restarts
 * and shares state across server replicas. One sorted set per (route, key)
 * with score = timestamp; we evict scores outside the window and reject when
 * the cardinality exceeds `max`.
 */
export function rateLimit({
  windowMs,
  max,
  bucketName,
  keyFn = (req) => (req.ip ?? req.socket.remoteAddress ?? 'unknown'),
}: {
  windowMs: number;
  max: number;
  bucketName?: string;
  keyFn?: (req: Parameters<RequestHandler>[0]) => string;
}): RequestHandler {
  const bucket = bucketName ?? `b${nanoid(6)}`;
  return (req, res, next) => {
    const subject = keyFn(req);
    const key = `ratelimit:${bucket}:${subject}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    void redis
      .multi()
      .zremrangebyscore(key, 0, windowStart)
      .zadd(key, now, `${now}-${nanoid(6)}`)
      .zcard(key)
      .pexpire(key, windowMs)
      .exec()
      .then((results) => {
        if (!results) return next();
        const cardEntry = results[2];
        const count = (cardEntry?.[1] as number | undefined) ?? 0;
        if (count > max) {
          const retryAfter = Math.ceil(windowMs / 1000);
          res.setHeader('Retry-After', String(retryAfter));
          res.status(429).json({ error: 'TOO_MANY_REQUESTS', retryAfter });
          return;
        }
        next();
      })
      .catch((err) => {
        // Fail-open on Redis errors — better to let the request through than
        // 500 the user out of the site when Redis blips.
        logger.error({ err, bucket }, 'rateLimit redis error, falling open');
        next();
      });
  };
}
