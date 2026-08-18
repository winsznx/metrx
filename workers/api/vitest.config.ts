import {defineConfig} from "vitest/config";
import {fileURLToPath} from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@metrx/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
