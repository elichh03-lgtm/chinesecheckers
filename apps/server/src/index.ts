import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { env, s3Configured } from './env.js';
import { router } from './routes.js';
import { attachSocket } from './socket.js';
import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { cleanupExpiredRefreshTokens } from './auth.js';
import { requestId } from './requestId.js';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

const app = express();
if (env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
}
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        // Review fix: when S3 is configured for avatar uploads, allow loading
        // those avatars via CSP. Hostname only ever comes from validated env.
        imgSrc: [
          "'self'",
          'data:',
          ...(s3Configured
            ? [`https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com`]
            : []),
        ],
        styleSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin' },
  }),
);
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestId);

app.get('/api/v1/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});
app.use('/api/v1', router);

if (env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Final express error handler — logs structured error and ensures a JSON
// response. Sentry.errorHandler (above) already captured the exception when
// a DSN is configured; capture here as a fallback for forced-throw debugging
// in environments without Sentry.
app.use((err: Error & { status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? 500;
  const reqLog = res.locals.logger ?? logger;
  reqLog.error({ err: err.message, stack: err.stack, status }, 'unhandled request error');
  if (!env.SENTRY_DSN && status >= 500) {
    Sentry.captureException(err);
  }
  if (res.headersSent) return;
  res.status(status).json({ error: status >= 500 ? 'INTERNAL_ERROR' : err.message });
});

const server = createServer(app);
const io = attachSocket(server);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'server listening');
});

// Review fix: prune expired / long-revoked refresh tokens at boot and every
// 6h thereafter. .unref()'d so it never holds the event loop open.
if (env.NODE_ENV !== 'test') {
  void cleanupExpiredRefreshTokens().catch((err) => {
    logger.error({ err }, 'refresh-cleanup boot run failed');
    Sentry.captureException(err);
  });
  setInterval(() => {
    void cleanupExpiredRefreshTokens().catch((err) => {
      logger.error({ err }, 'refresh-cleanup interval run failed');
      Sentry.captureException(err);
    });
  }, 6 * 60 * 60 * 1000).unref();
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown received, draining');
  io.of('/game').emit('server:shutdown', { graceMs: 5000 });
  await new Promise((r) => setTimeout(r, 1000));
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  logger.info('shutdown done');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
