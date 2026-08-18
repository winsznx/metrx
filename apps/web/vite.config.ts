import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import {fileURLToPath} from "node:url";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@metrx/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@metrx/reference": fileURLToPath(new URL("../../packages/reference/src/settlementModel.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
