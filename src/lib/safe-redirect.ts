const FALLBACK = "/dashboard";

/**
 * Only same-origin relative paths are allowed as post-login destinations; anything else
 * (absolute URLs, protocol-relative "//evil.com", backslash tricks) falls back to the dashboard.
 */
export function safeCallbackPath(value: string | string[] | null | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return FALLBACK;
  }
  if (candidate === "/login" || candidate.startsWith("/login?") || candidate.startsWith("/api/")) return FALLBACK;
  return candidate;
}
