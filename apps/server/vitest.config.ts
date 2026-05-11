import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Integration tests share Redis DB 15 and the test Postgres DB; running
    // files in parallel makes them clobber each other's state.
    fileParallelism: false,
    env: {
      // Tests target an isolated Postgres database (operator runs the
      // migrations against this URL once) and Redis DB 15 (flushed per test).
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/chinesecheckers_test',
      REDIS_URL: 'redis://localhost:6379/15',
      NODE_ENV: 'test',
    },
  },
});
