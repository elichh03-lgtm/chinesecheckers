import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
};

async function loadEnv(overrides: Record<string, string | undefined>): Promise<typeof import('../env.js')> {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  return await import('../env.js');
}

afterEach(() => {
  if (ORIGINAL.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL.NODE_ENV;
  if (ORIGINAL.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL.JWT_SECRET;
  vi.resetModules();
});

describe('env validation', () => {
  it('throws in production when JWT_SECRET is the dev default', async () => {
    await expect(
      loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-in-prod' }),
    ).rejects.toThrow(/JWT_SECRET must be set/);
  });

  it('does not throw in development with the dev default', async () => {
    await expect(
      loadEnv({ NODE_ENV: 'development', JWT_SECRET: 'dev-secret-change-in-prod' }),
    ).resolves.toBeDefined();
  });

  it('does not throw in production when JWT_SECRET is overridden', async () => {
    await expect(
      loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'a-real-production-secret-value' }),
    ).resolves.toBeDefined();
  });
});
