const GENERATE_HINT = 'Generate with: openssl rand -base64 32';

// Secrets that ship in this repository, so they are public knowledge to anyone
// who can read it. A deployment that keeps one has no secret at all, and the
// length check alone would wave the sample value through.
const PUBLISHED_SECRETS = new Set([
  'change-me-to-a-random-32-byte-secret',
  'synthetic-e2e-secret-not-for-production',
]);

export function jwtSecretError(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env['NODE_ENV'] !== 'production') return null;
  const jwtSecret = env['JWT_SECRET'];
  if (!jwtSecret || Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    return `JWT_SECRET is missing or shorter than 32 bytes — tokens can be forged. ${GENERATE_HINT}`;
  }
  if (PUBLISHED_SECRETS.has(jwtSecret) || jwtSecret.toLowerCase().includes('change-me')) {
    return `JWT_SECRET is still a published example value — tokens can be forged by anyone who has read this repository. ${GENERATE_HINT}`;
  }
  if (env['DEV_OTP_BYPASS'] === 'true') {
    return 'DEV_OTP_BYPASS cannot be enabled in production';
  }
  return null;
}

export type TrustProxySetting = false | 'loopback' | number;

export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'false') return false;
  if (normalized === 'loopback') return 'loopback';
  if (/^[1-9]\d*$/.test(normalized)) return Number(normalized);
  throw new Error('TRUST_PROXY must be false, loopback, or a positive hop count');
}
