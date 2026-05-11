import nodemailer, { type Transporter } from 'nodemailer';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env, smtpConfigured } from '../env.js';
import { logger } from './logger.js';

export const JSON_OUTBOX_PATH =
  process.env.MAIL_JSON_OUTBOX ?? '.mail-outbox.jsonl';

type Mode = 'smtp' | 'json' | 'disabled';

let cached: { transporter: Transporter; mode: Mode } | null = null;

function build(): { transporter: Transporter; mode: Mode } {
  if (smtpConfigured) {
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
    });
    return { transporter, mode: 'smtp' };
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SMTP is not configured but NODE_ENV=production');
  }
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  return { transporter, mode: 'json' };
}

function getTransport(): { transporter: Transporter; mode: Mode } {
  if (!cached) cached = build();
  return cached;
}

export function getMailerMode(): Mode {
  return getTransport().mode;
}

export function resetMailerForTests(): void {
  cached = null;
}

function fromAddress(): string {
  return env.SMTP_FROM ?? 'no-reply@halma.local';
}

export type PasswordResetArgs = {
  to: string;
  username: string;
  token: string;
};

export async function sendPasswordReset(args: PasswordResetArgs): Promise<void> {
  const { transporter, mode } = getTransport();
  const url = `${env.CLIENT_URL}/reset?token=${encodeURIComponent(args.token)}`;
  const subject = 'Reset your Halma password';
  const text = [
    `Hi ${args.username},`,
    '',
    'A password reset was requested for your Halma account.',
    'Open the link below to choose a new password (valid for 1 hour):',
    '',
    url,
    '',
    "If you didn't request this, you can ignore this email.",
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(args.username)},</p>
<p>A password reset was requested for your Halma account. Click below to choose a new password (valid for 1 hour):</p>
<p><a href="${url}">${url}</a></p>
<p>If you didn't request this, you can ignore this email.</p>`;

  const info = await transporter.sendMail({
    from: fromAddress(),
    to: args.to,
    subject,
    text,
    html,
  });

  if (mode === 'json') {
    const message = info.message as string;
    logger.info({ component: 'mailer', mode: 'json' }, message);
    try {
      mkdirSync(dirname(JSON_OUTBOX_PATH), { recursive: true });
    } catch {
      // dirname may be '.' — ignore
    }
    appendFileSync(JSON_OUTBOX_PATH, message + '\n', 'utf8');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
