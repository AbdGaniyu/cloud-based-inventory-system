/**
 * The client's IP for rate limiting, from a source the client cannot forge:
 * - CLIENT_IP_HEADER names a header your edge sets itself (e.g. cf-connecting-ip, x-real-ip);
 * - on Vercel, the platform rewrites X-Forwarded-For, so its first entry is the client;
 * - otherwise TRUSTED_PROXY_COUNT (default 1) reverse proxies each appended one X-Forwarded-For
 *   entry, so the client is that many entries from the right. Entries further left were written by
 *   the client and are ignored. With 0 trusted proxies, no IP is trusted (returns null).
 */
type HeaderBag = Headers | Record<string, string | string[] | undefined>;

function read(headers: HeaderBag, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value;
}

const IP = /^[0-9a-fA-F:.]{2,45}$/;
const clean = (value: string | undefined) => {
  const v = value?.trim();
  return v && IP.test(v) ? v : null;
};

export function clientIp(headers: HeaderBag, env: Record<string, string | undefined> = process.env): string | null {
  if (env.CLIENT_IP_HEADER) return clean(read(headers, env.CLIENT_IP_HEADER.toLowerCase())?.split(",")[0]);
  const forwarded = (read(headers, "x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.VERCEL) return clean(forwarded[0]);
  const hops = Number(env.TRUSTED_PROXY_COUNT ?? 1);
  if (!Number.isInteger(hops) || hops < 1 || forwarded.length < hops) return null;
  return clean(forwarded[forwarded.length - hops]);
}
