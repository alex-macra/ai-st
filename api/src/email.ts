import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer') as typeof import('nodemailer');

function createTransport() {
  const host = process.env['SMTP_HOST'];
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: Number(process.env['SMTP_PORT'] ?? 587),
    secure: process.env['SMTP_SECURE'] === 'true',
    auth: process.env['SMTP_USER']
      ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] ?? '' }
      : undefined,
  });
}

const FROM = process.env['SMTP_FROM'] ?? 'Somnoscribe <noreply@example.test>';

export async function sendOtp(email: string, code: string): Promise<void> {
  const transport = createTransport();

  if (!transport) {
    console.warn('SMTP is not configured; the sign-in code was not sent.');
    return;
  }

  await transport.sendMail({
    from: FROM,
    to: email,
    subject: 'Your Somnoscribe sign-in code',
    text: `Your sign-in code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`,
    html: `
      <p>Your Somnoscribe sign-in code is:</p>
      <p style="font-size:2rem;letter-spacing:.25em;font-weight:bold">${code}</p>
      <p>This code expires in 10 minutes. Do not share it.</p>
    `,
  });
}
