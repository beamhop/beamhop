import { expect, test } from "@playwright/test";
import { startSmokeHost, type SmokeHostHandle } from "./_host.ts";

const skip = !process.env.RUN_INTEGRATION;
test.describe.configure({ mode: "serial" });

test.describe("M2 — share a sandbox terminal end-to-end", () => {
  test.skip(skip, "set RUN_INTEGRATION=1 to run (boots a real microVM)");

  let host: SmokeHostHandle;
  let joinUrl = "";

  test.beforeAll(async () => {
    host = await startSmokeHost();
    joinUrl = host.joinUrl;
  });

  test.afterAll(async () => {
    if (host) await host.shutdown();
  });

  test("joiner connects via WebRTC and sees guest-side uname output", async ({
    page,
  }) => {
    await page.goto(joinUrl);

    // Wait for the connected state. The chrome shows "live · 00:0X" once the
    // connection lands.
    await expect(page.getByText(/live ·/)).toBeVisible({ timeout: 120_000 });

    // Drive the in-page wterm: click into the .wterm container to focus its
    // hidden input textarea, then use the keyboard API to type.
    const term = page.locator(".wterm");
    await term.click();
    await page.keyboard.type("uname -a");
    await page.keyboard.press("Enter");

    // Look for "Linux" anywhere in the rendered terminal grid.
    await expect(term.locator(".term-grid")).toContainText(/Linux/i, {
      timeout: 30_000,
    });
  });
});
