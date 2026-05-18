import { test, expect } from "../fixtures/strict-page.js";

test.describe("app boots cleanly", () => {
  test("renders cockpit chrome and reaches ready state", async ({ page, violations }) => {
    await page.goto("/");

    // Header brand mark.
    await expect(page.locator("text=beamhop")).toBeVisible();

    // Sidebar — the literal heading is "agents".
    await expect(page.locator("text=agents").first()).toBeVisible();

    // All seven agents from the e2e registry appear in the sidebar, identified
    // by data-agent-id (scoped tight to avoid matching the same label in
    // header/chat panels). "idle-exit" is the e2e-only flake-scenario slot
    // (real registry has six built-ins).
    for (const id of [
      "claude-code",
      "idle-exit",
      "gemini",
      "codex",
      "opencode",
      "copilot",
      "pi-mono",
    ]) {
      await expect(page.locator(`button[data-agent-id="${id}"]`)).toBeVisible();
    }

    // Empty-state chat copy.
    await expect(page.locator("text=ready when you are.")).toBeVisible();

    // Log drawer toggle button is present.
    await expect(
      page.locator('button[aria-label="collapse log"], button[aria-label="expand log"]'),
    ).toBeVisible();

    // Status indicator should reach "ready" once the WS handshake completes.
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // The initial active row is claude-code.
    await expect(page.locator('button[data-agent-id="claude-code"][data-agent-active="true"]')).toBeVisible();

    void violations;
  });
});
