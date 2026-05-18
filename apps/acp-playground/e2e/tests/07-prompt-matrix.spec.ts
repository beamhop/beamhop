import { test, expect } from "../fixtures/strict-page.js";

/**
 * Regression matrix: send a prompt to every built-in agent and assert it
 * round-trips. Catches per-agent breakage early.
 *
 * Skips:
 *  - `idle-exit` — in e2e mode wired to "exits while idle" (covered by 06)
 *  - `codex` — wired to permission flow (covered by 04)
 *  - `opencode` — wired to "hang on prompt" to test the timeout (covered by 08)
 */
const AGENTS_TO_PROMPT = ["claude-code", "gemini", "copilot", "pi-mono"] as const;

test.describe("prompt round-trips for every agent", () => {
  for (const agentId of AGENTS_TO_PROMPT) {
    test(`prompt + end_turn works for ${agentId}`, async ({ page, violations }) => {
      await page.goto("/");
      await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

      // Switch to the target agent (if not already active).
      const row = page.locator(`button[data-agent-id="${agentId}"]`);
      const initiallyActive = await row.getAttribute("data-agent-active");
      if (initiallyActive !== "true") {
        await row.click();
        await expect(row).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
        await expect(row.locator("text=live")).toBeVisible({ timeout: 8000 });
      }

      // Send a prompt.
      const composer = page.locator("textarea");
      await composer.click();
      await composer.fill(`hi from ${agentId}`);
      await composer.press("Meta+Enter");

      // Streamed text appears, then end_turn.
      await expect(page.getByText(`hi from ${agentId}`)).toBeVisible();
      await expect(page.getByText("end_turn")).toBeVisible({ timeout: 8000 });

      // No log-drawer error banner.
      await expect(page.getByText(/last error/i)).toHaveCount(0);

      void violations;
    });
  }
});
