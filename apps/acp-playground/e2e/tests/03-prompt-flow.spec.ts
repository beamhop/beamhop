import { test, expect } from "../fixtures/strict-page.js";

test.describe("prompt flow", () => {
  test("send → stream → end_turn against a fake agent", async ({ page, violations }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    // Type into the composer.
    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("hello world");

    // ⌘+Enter (or Ctrl+Enter on non-mac) — Playwright normalises Meta on darwin.
    await composer.press("Meta+Enter");

    // The user turn appears.
    await expect(page.getByText("hello world")).toBeVisible();

    // Fake agent streams the literal text "hello".
    await expect(page.locator("text=hello").nth(1)).toBeVisible({ timeout: 5000 });

    // Stream completes — the "streaming" indicator goes away, the "end_turn"
    // stopReason appears.
    await expect(page.getByText("end_turn")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("streaming")).toHaveCount(0);

    void violations;
  });
});
