import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isHttps = (process.env.APP_URL ?? "").startsWith("https://");

/**
 * Content Security Policy. Cache Components prerenders static shells, which cannot carry a
 * per-request nonce, so inline scripts and styles stay allowed (Next.js guide, "Without Nonces").
 * Everything else is locked to this origin: no third-party scripts, no framing, no plugins, no
 * base-URL or form-target hijacking.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The POS reads barcode scanners as keyboards; nothing needs the camera, microphone or location.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep the dev badge clear of the branch rail's account button (bottom-left).
  devIndicators: { position: "bottom-right" },
  // PDF routes read the vendored font files at runtime; make sure they ship with those functions.
  outputFileTracingIncludes: { "/api/pdf/**": ["./src/server/pdf/fonts/**"] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages get the CSP; API responses (PDF, CSV, JSON) are not documents that run scripts.
      { source: "/((?!api/|_next/static|_next/image|favicon.ico).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
