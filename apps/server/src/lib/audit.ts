import type { Request } from 'express';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

export type AuditAction =
  | 'login.success'
  | 'login.failure'
  | 'password.change'
  | 'password.reset.issued'
  | 'password.reset.used'
  | 'account.deleted'
  | 'oauth.login'
  | 'refresh.family_revoked'
  | 'admin.access';

export type AuditEntry = {
  userId?: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export function ipFromReq(req: Request): string | null {
  return req.ip ?? req.socket.remoteAddress ?? null;
}

export function uaFromReq(req: Request): string | null {
  return req.header('user-agent') ?? null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        metadata: (entry.metadata ?? {}) as object,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit log write failed');
  }
}
