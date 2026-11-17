import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
