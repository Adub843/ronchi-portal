import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// The preview build shown inside Claude: one self-contained file, example data, no server.
// `npm run build:demo` writes web/dist-demo/index.html; scripts/inline-demo.mjs makes it one file.
export default mergeConfig(
  base,
  defineConfig({
    mode: "demo",
    base: "./",
    build: {
      outDir: "dist-demo",
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }),
);
