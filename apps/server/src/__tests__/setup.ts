import { beforeEach, afterAll } from 'vitest';
import { redis } from '../lib/redis.js';

// Safety: refuse to FLUSHDB unless we're pointed at the dedicated test DB.
// `ioredis` stores the selected DB index on `redis.options.db`.
const TEST_DB = 15;

beforeEach(async () => {
  if (redis.options.db !== TEST_DB) {
    throw new Error(
      `[test setup] refusing to FLUSHDB: REDIS_URL must point at /${TEST_DB}, got /${redis.options.db}`,
    );
  }
  try {
    await redis.flushdb();
  } catch {
    // Local-dev fallback: when Redis isn't running, tests that don't depend on
    // it (most of the suite) should still execute. Rate-limit and game-state
    // tests will fail naturally on their own assertions when this happens.
  }
});

afterAll(async () => {
  await redis.quit().catch(() => {});
});
