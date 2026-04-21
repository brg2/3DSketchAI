import { defineConfig, devices } from "@playwright/test";

const slowMo = Number(process.env.PLAYWRIGHT_SLOW_MO ?? 0);

export default defineConfig({
  testDir: "./tests/tools",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      slowMo,
      args: [
        // WebGL-heavy screenshot tests are much more stable in software rendering.
        "--use-angle=swiftshader",
        "--use-gl=swiftshader",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
