import { test, expect } from "../fixtures/strict-page.js";

test.describe("agent exiting while idle (user-reported bug)", () => {
  test("send after idle-exit recovers without showing agent_exited", async ({
    page,
    violations,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // Switch to idle-exit — wired in e2e mode to exit ~300ms after init.
    const idleRow = page.locator('button[data-agent-id="idle-exit"]');
    await idleRow.click();
    await expect(idleRow).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
    await expect(idleRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    // Wait for the agent to exit while idle (the bug condition).
    await page.waitForTimeout(800);

    // Try to send a prompt.
    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("hello");
    await composer.press("Meta+Enter");

    // Must NOT show "last error · agent_exited" in the log drawer.
    // (this assertion is what fails today — the bug the user reported)
    await expect(page.getByText(/last error/i)).toHaveCount(0, { timeout: 2000 });
    await expect(page.getByText("agent_exited")).toHaveCount(0);

    // The prompt should ultimately succeed (gateway respawns transparently).
    await expect(page.getByText("end_turn")).toBeVisible({ timeout: 8000 });

    void violations;
  });
});
