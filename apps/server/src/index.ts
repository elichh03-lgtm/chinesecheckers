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
import { cleanupExpiredRefreshTokens } from './auth.js';

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

app.get('/api/v1/health', (_req, res) => res.json({ ok: true }));
app.use('/api/v1', router);

if (env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

const server = createServer(app);
const io = attachSocket(server);

server.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on :${env.PORT}`);
});

// Review fix: prune expired / long-revoked refresh tokens at boot and every
// 6h thereafter. .unref()'d so it never holds the event loop open.
if (env.NODE_ENV !== 'test') {
  void cleanupExpiredRefreshTokens().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[refresh-cleanup] boot run failed', err);
  });
  setInterval(() => {
    void cleanupExpiredRefreshTokens().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[refresh-cleanup] interval run failed', err);
    });
  }, 6 * 60 * 60 * 1000).unref();
}

/**
 * Graceful shutdown: drain socket connections, close the HTTP server, then
 * disconnect Prisma. Active games are NOT auto-completed (would skew ELO);
 * connected clients get a transport-level disconnect and can reconnect against
 * a new instance once it boots.
 */
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[shutdown] received ${signal}, draining...`);
  // Emit a server:shutdown event so clients can show a banner before disconnect.
  io.of('/game').emit('server:shutdown', { graceMs: 5000 });
  // Allow 1s for the broadcast to flush.
  await new Promise((r) => setTimeout(r, 1000));
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  // eslint-disable-next-line no-console
  console.log('[shutdown] done');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
