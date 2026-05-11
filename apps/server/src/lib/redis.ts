import Redis from 'ioredis';
import { env } from '../env.js';
import { logger } from './logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'redis error');
});
