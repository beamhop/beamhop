import { expect, test, type Page } from "@playwright/test";
import { startSmokeHost, type SmokeHostHandle } from "./_host.ts";

const skip = !process.env.RUN_INTEGRATION;
test.describe.configure({ mode: "serial" });

test.describe("M3 — soft input-lock arbitration across two peers", () => {
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

  test("holder badge flips between peers as each one types", async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    try {
      await Promise.all([a.goto(joinUrl), b.goto(joinUrl)]);

      // Both must be connected before we drive the lock.
      await Promise.all([
        expect(a.getByText(/live ·/)).toBeVisible({ timeout: 120_000 }),
        expect(b.getByText(/live ·/)).toBeVisible({ timeout: 120_000 }),
      ]);

      // Capture each page's stable peer id from the badge so the test asserts
      // against ground truth instead of relying on "first to connect wins".
      const aSelf = await badgeOf(a).getAttribute("data-self-peer-id");
      const bSelf = await badgeOf(b).getAttribute("data-self-peer-id");
      expect(aSelf).toBeTruthy();
      expect(bSelf).toBeTruthy();
      expect(aSelf).not.toBe(bSelf);

      // Make sure both peers see a clean (released) baseline before we test.
      // The host broadcasts the current holder on join, so each side gets one
      // initial frame — wait until both report "free" before driving the lock.
      await expect(badgeOf(a)).toHaveAttribute("data-holder-peer", "", {
        timeout: 5_000,
      });
      await expect(badgeOf(b)).toHaveAttribute("data-holder-peer", "", {
        timeout: 5_000,
      });

      // Peer A types -> both UIs should see A as holder.
      await typeInTerminal(a, "echo from-a");
      await expect(badgeOf(a)).toHaveAttribute("data-holder-peer", aSelf!, {
        timeout: 5_000,
      });
      await expect(badgeOf(b)).toHaveAttribute("data-holder-peer", aSelf!, {
        timeout: 5_000,
      });

      // Wait beyond the 800ms TTL so the holder releases.
      await a.waitForTimeout(1100);

      await expect(badgeOf(a)).toHaveAttribute("data-holder-peer", "", {
        timeout: 2_000,
      });
      await expect(badgeOf(b)).toHaveAttribute("data-holder-peer", "", {
        timeout: 2_000,
      });

      // Now peer B types -> both UIs flip to B.
      await typeInTerminal(b, "echo from-b");
      await expect(badgeOf(b)).toHaveAttribute("data-holder-peer", bSelf!, {
        timeout: 5_000,
      });
      await expect(badgeOf(a)).toHaveAttribute("data-holder-peer", bSelf!, {
        timeout: 5_000,
      });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

function badgeOf(page: Page) {
  return page.getByTestId("holder-badge");
}

async function typeInTerminal(page: Page, text: string): Promise<void> {
  // wterm captures keystrokes via a hidden textarea inside `.wterm`.
  // Focus that textarea directly — clicking the `.wterm` div doesn't
  // reliably transfer focus to the offscreen textarea.
  await page.locator(".wterm textarea").first().focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
