import Redis from 'ioredis';
import { env } from '../env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[redis] error', err.message);
});
