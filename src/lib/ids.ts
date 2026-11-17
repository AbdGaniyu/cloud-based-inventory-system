const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Largest multiple of 62 below 256; bytes at or above it are rejected so every character is equally likely.
const UNBIASED_LIMIT = 248;

/**
 * Short unguessable ID for public URLs (warranty verification /w/[publicId]).
 * 10 base62 characters ≈ 59.5 bits of entropy.
 */
export function randomPublicId(length = 10): string {
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}
