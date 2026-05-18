import { test, expect } from "../fixtures/strict-page.js";

test.describe("permission dialog", () => {
  test("agent requests permission, user allows, tool call completes", async ({
    page,
    violations,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // Switch to Codex — the e2e server wires it to the 'permission' fake-agent
    // behavior, which sends session/request_permission mid-prompt.
    const codexRow = page.locator('button[data-agent-id="codex"]');
    await codexRow.click();
    await expect(codexRow).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
    await expect(codexRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    // Send a prompt.
    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("touch a file");
    await composer.press("Meta+Enter");

    // The permission dialog slides up.
    await expect(page.getByText("permission required")).toBeVisible({ timeout: 5000 });

    // Click allow.
    await page.getByRole("button", { name: /allow once/i }).click();

    // The dialog closes.
    await expect(page.getByText("permission required")).toHaveCount(0, { timeout: 5000 });

    // Tool call status updates to "completed".
    await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });

    // Stream finishes with end_turn.
    await expect(page.getByText("end_turn")).toBeVisible({ timeout: 5000 });

    void violations;
  });
});
