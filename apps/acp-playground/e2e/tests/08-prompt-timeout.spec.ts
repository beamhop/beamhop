import { test, expect } from "../fixtures/strict-page.js";

/**
 * Regression for the user-reported bug:
 *   "send a message to opencode → it says agent streaming and thinking but
 *    nothing happens"
 *
 * The opencode slot in e2e mode is wired to a fake that ack's the prompt with
 * one session/update notification and then never finalizes — mirroring real
 * opencode when its upstream LLM is rate-limited. The gateway's
 * `promptTimeoutMs` (lowered to 2s in e2e mode) must fire a typed rpc-error so
 * the UI stops hanging and shows the user what's wrong.
 */
test.describe("prompt timeout when agent hangs", () => {
  test("opencode (hang fake) → timeout → UI surfaces error, not infinite spinner", async ({
    page,
    violations,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });

    const opencodeRow = page.locator('button[data-agent-id="opencode"]');
    await opencodeRow.click();
    await expect(opencodeRow).toHaveAttribute("data-agent-active", "true", { timeout: 5000 });
    await expect(opencodeRow.locator("text=live")).toBeVisible({ timeout: 8000 });

    const composer = page.locator("textarea");
    await composer.click();
    await composer.fill("hi");
    await composer.press("Meta+Enter");

    // The agent streams "thinking..." first.
    await expect(page.getByText("thinking...")).toBeVisible({ timeout: 3000 });

    // Then the gateway's timeout fires. The ChatPanel prints the error message
    // inside the agent turn (`[error] ...`) and the streaming indicator stops.
    await expect(page.getByText(/timed out/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("streaming")).toHaveCount(0);

    void violations;
  });
});
