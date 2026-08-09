import { defineConfig } from "@playwright/test";
import webGpuChromeArgs from "./scripts/webgpu-chrome-profile.json" with { type: "json" };

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        launchOptions: {
          env: {
            MOZ_DISABLE_CONTENT_SANDBOX: "1",
            MOZ_DISABLE_GMP_SANDBOX: "1",
            MOZ_DISABLE_GPU_SANDBOX: "1",
            MOZ_DISABLE_RDD_SANDBOX: "1",
            MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: "1",
          },
        },
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
    {
      name: "chrome",
      use: {
        channel: "chrome",
        launchOptions: {
          args: webGpuChromeArgs,
        },
      },
    },
    {
      name: "edge",
      use: { channel: "msedge" },
    },
  ],
});
