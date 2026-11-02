import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored MediaPipe runtime (copied by scripts/copy-mediapipe.mjs).
    "public/mediapipe/**",
    // The API bundle (npm run build:server) and the original Supabase code (not deployed).
    "server/dist/**",
    "original-supabase/**",
  ]),
]);

export default eslintConfig;
