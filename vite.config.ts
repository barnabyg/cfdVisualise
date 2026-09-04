import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // CPU and WebGPU workers intentionally package their complete numerical
    // backends for isolation. Review this limit if any chunk exceeds 700 kB or
    // when the solver modules gain a shared-worker-safe split point.
    chunkSizeWarningLimit: 700,
  },
});
