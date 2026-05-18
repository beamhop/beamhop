import { test, expect } from "../fixtures/strict-page.js";

test.describe("agent registry switching", () => {
  test("clicking a different agent triggers switch → live", async ({ page, violations }) => {
    await page.goto("/");

    // Wait for initial ready state.
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // The active row carries data-agent-active="true". Initially it should be
    // claude-code (the server's defaultAgent).
    const claudeRow = page.locator('button[data-agent-id="claude-code"]');
    const geminiRow = page.locator('button[data-agent-id="gemini"]');
    await expect(claudeRow).toHaveAttribute("data-agent-active", "true");
    await expect(geminiRow).toHaveAttribute("data-agent-active", "false");

    // Click the Gemini row.
    await geminiRow.click();

    // Active flips to Gemini.
    await expect(geminiRow).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
    await expect(claudeRow).toHaveAttribute("data-agent-active", "false");

    // The "switching" indicator should appear during the swap; it may flicker
    // very briefly, so we don't assert its presence — only that it's gone once
    // the swap completes (the row shows "live").
    await expect(geminiRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    // Regression: switching used to fire a fatal "agent_exited" error from
    // the unintentional onExit hook. Assert the log drawer's last-error banner
    // is NOT showing.
    await expect(page.getByText(/last error/i)).toHaveCount(0);

    void violations;
  });
});
