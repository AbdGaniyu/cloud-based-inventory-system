import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { z } from "zod";

/**
 * Encryption for secret Setting rows (invariant 14). AES-256-GCM with a key from
 * SETTINGS_ENCRYPTION_KEY (32 bytes, base64), or derived from AUTH_SECRET with HKDF when that is
 * not set. Plaintext never leaves the server; the UI only ever sees the last four characters.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export const encryptedValueSchema = z.object({ v: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
export type EncryptedValue = z.infer<typeof encryptedValueSchema>;

function key(): Buffer {
  const explicit = process.env.SETTINGS_ENCRYPTION_KEY;
  if (explicit) {
    const decoded = Buffer.from(explicit, "base64");
    if (decoded.length !== 32) throw new Error("SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return decoded;
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Set SETTINGS_ENCRYPTION_KEY or AUTH_SECRET to store provider keys");
  return Buffer.from(hkdfSync("sha256", secret, "gadget-hub", "settings-encryption", 32));
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

/** Throws if the value was tampered with or the key changed. */
export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
}

/** "••••1234": all a browser ever sees of a stored key. */
export function maskSecret(plaintext: string): string {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}
