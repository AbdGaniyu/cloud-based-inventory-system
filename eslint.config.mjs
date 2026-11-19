import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // @react-pdf/renderer primitives render to PDF, not the DOM; its <Image> has no alt prop.
    files: ["src/server/pdf/**/*.tsx"],
    rules: { "jsx-a11y/alt-text": "off" },
  },
  {
    // Passenger (cPanel "Setup Node.js App") loads the startup file with require(), so it stays CommonJS.
    files: ["server.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
