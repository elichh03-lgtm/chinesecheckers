import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().default(3001),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().default('dev-secret-change-in-prod'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SENTRY_DSN: z.string().optional(),
  ADMIN_USER_ID: z.string().optional(),
  // Socket.io Redis adapter — required for horizontal scale (multi-replica
  // production), but adds pub/sub round-trips that slow single-process dev.
  // Set to "true" in production; leave unset/false elsewhere.
  SOCKET_REDIS_ADAPTER: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  REQUIRE_SMTP: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export const env = Schema.parse(process.env);

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-change-in-prod') {
  throw new Error('JWT_SECRET must be set to a non-default value in production');
}

export const smtpConfigured: boolean = Boolean(
  env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM,
);

if (env.REQUIRE_SMTP && !smtpConfigured) {
  throw new Error(
    'REQUIRE_SMTP=true but SMTP_HOST/PORT/USER/PASS/FROM are not all configured',
  );
}

export const googleConfigured: boolean = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

export const s3Configured: boolean = Boolean(
  env.AWS_S3_BUCKET && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY,
);

export function googleCallbackUrl(): string {
  return env.GOOGLE_CALLBACK_URL ?? `http://localhost:${env.PORT}/api/v1/auth/google/callback`;
}
