import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5180);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // single-port webServer; tests must share it serially
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun src/server/index.ts",
    url: BASE_URL,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      // Switches the server to a deterministic fake-agent registry that needs
      // no external CLIs installed. See src/server/index.ts.
      ACP_PLAYGROUND_E2E: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
