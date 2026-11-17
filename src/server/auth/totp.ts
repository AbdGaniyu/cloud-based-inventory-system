import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 time-based one-time passwords (what Google Authenticator, Microsoft Authenticator, 1Password
 * and friends generate): HMAC-SHA1, 6 digits, 30-second steps. Small enough not to need a dependency.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now that still count, for phone clocks that drift. */
const DRIFT_STEPS = 1;
const SECRET_BYTES = 20;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Lenient about case, spaces, dashes and padding, as people type keys by hand. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Not a base32 key");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function stepAt(time: Date): number {
  return Math.floor(time.getTime() / 1000 / STEP_SECONDS);
}

export function totpAt(secret: string, time: Date): string {
  return hotp(base32Decode(secret), stepAt(time));
}

/**
 * The step the code belongs to, or null. Steps at or before `lastStep` are refused so a code that was
 * already used (seen over a shoulder, or replayed) cannot sign in again.
 */
export function verifyTotp(secret: string, code: string, time: Date = new Date(), lastStep: number | null = null): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const key = base32Decode(secret);
  const now = stepAt(time);
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(typed))) return step;
  }
  return null;
}

export function otpauthUri({ secret, account, issuer }: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = `secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  return `otpauth://totp/${label}?${query}`;
}

/** Recovery codes look like "k7m2q-x9p4t"; returns the canonical form, or null when it is not one. */
export function normalizeRecoveryCode(text: string): string | null {
  const clean = text.toLowerCase().replace(/[\s-]/g, "");
  return /^[a-z0-9]{10}$/.test(clean) ? clean : null;
}
