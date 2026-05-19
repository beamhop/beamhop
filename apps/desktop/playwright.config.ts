import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DESKTOP_UI_PORT ?? 5175);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  timeout: 360_000,
  expect: { timeout: 60_000 },
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun --hot src/server.ts`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
