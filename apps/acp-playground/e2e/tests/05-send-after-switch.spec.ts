import { test, expect } from "../fixtures/strict-page.js";

test.describe("send after switching agents", () => {
  test("switch → send prompt → receive stream → no agent_exited error", async ({
    page,
    violations,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // Switch to gemini.
    const geminiRow = page.locator('button[data-agent-id="gemini"]');
    await geminiRow.click();
    await expect(geminiRow).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
    await expect(geminiRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    // Now try to send a prompt.
    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("hello after switch");
    await composer.press("Meta+Enter");

    // The streamed response should appear.
    await expect(page.getByText("end_turn")).toBeVisible({ timeout: 8000 });

    // Critical: the log drawer's "last error" banner must NOT appear with
    // agent_exited (the bug the user reported).
    await expect(page.getByText(/last error/i)).toHaveCount(0);
    await expect(page.getByText("agent_exited")).toHaveCount(0);

    void violations;
  });

  test("send a prompt twice on the same switched-to agent", async ({ page, violations }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    const geminiRow = page.locator('button[data-agent-id="gemini"]');
    await geminiRow.click();
    await expect(geminiRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    const composer = page.locator("textarea");

    await composer.click();
    await composer.fill("first");
    await composer.press("Meta+Enter");
    await expect(page.getByText("end_turn").first()).toBeVisible({ timeout: 8000 });

    await composer.click();
    await composer.fill("second");
    await composer.press("Meta+Enter");
    // Two end_turn markers now exist.
    await expect(page.getByText("end_turn")).toHaveCount(2, { timeout: 8000 });

    await expect(page.getByText(/last error/i)).toHaveCount(0);
    await expect(page.getByText("agent_exited")).toHaveCount(0);

    void violations;
  });

  test("switch back to the original agent and send", async ({ page, violations }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    const claudeRow = page.locator('button[data-agent-id="claude-code"]');
    const geminiRow = page.locator('button[data-agent-id="gemini"]');

    await geminiRow.click();
    await expect(geminiRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    await claudeRow.click();
    await expect(claudeRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("after round trip");
    await composer.press("Meta+Enter");
    await expect(page.getByText("end_turn")).toBeVisible({ timeout: 8000 });

    await expect(page.getByText(/last error/i)).toHaveCount(0);
    await expect(page.getByText("agent_exited")).toHaveCount(0);

    void violations;
  });
});
