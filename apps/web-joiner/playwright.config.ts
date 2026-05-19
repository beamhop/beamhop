import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.WEB_JOINER_PORT ?? 5174);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/*.spec.ts"],
  timeout: 180_000,
  expect: { timeout: 30_000 },
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
