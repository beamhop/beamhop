import { expect, test } from "@playwright/test";
import { startSidecar, type SidecarHandle } from "./_sidecar.ts";

const skip = !process.env.RUN_INTEGRATION;
test.describe.configure({ mode: "serial" });

test.describe("M5 — desktop UI drives a sandbox + session end-to-end", () => {
  test.skip(skip, "set RUN_INTEGRATION=1 to run (boots a real microVM)");

  let sidecar: SidecarHandle;

  test.beforeAll(async () => {
    sidecar = await startSidecar();
  });

  test.afterAll(async () => {
    if (sidecar) await sidecar.shutdown();
  });

  test("build alpine image, boot sandbox, start terminal, type, see Linux", async ({
    page,
  }) => {
    await page.goto(`/?sidecarPort=${sidecar.port}`);

    // Sidecar should connect quickly and TopBar should report 'live'.
    await expect(page.getByText("sidecar · live")).toBeVisible({
      timeout: 30_000,
    });

    // Use the "build from dockerfile" path. A stable tag + Dockerfile means
    // beambox's content-addressed cache hits on repeat runs — first run
    // takes 10-30s for the pull, subsequent runs are ~instant.
    const tag = "m5-e2e:test";
    await page.getByTestId("new-sandbox").click();
    await page.getByRole("button", { name: /build from dockerfile/i }).click();
    await page.getByTestId("build-tag-input").fill(tag);
    // The dialog seeds dockerfile with the alpine starter; keep it.
    await page.getByTestId("confirm-create").click();

    // A sandbox row should appear in the left rail (after image build).
    await expect(
      page.locator("[data-testid^='sandbox-sb_']").first(),
    ).toBeVisible({ timeout: 120_000 });

    // Start a terminal — auto-selects.
    await page.getByTestId("start-terminal").click();

    // The right pane should show the live terminal.
    await expect(page.getByTestId("live-terminal")).toBeVisible({
      timeout: 30_000,
    });

    // Drive the wterm. The <bun-hmr> dev overlay intercepts pointer events,
    // and `force: true` bypasses the visibility check but doesn't actually
    // dispatch a click event the wterm sees. Focus the inner textarea
    // directly via the DOM API instead.
    // Drive wterm directly via its hidden textarea. We can't reliably .click()
    // because Bun's dev <bun-hmr> overlay intercepts pointer events, and
    // page.keyboard.type can race with focus during React renders.
    const ta = page.locator(".wterm textarea").first();
    await ta.waitFor({ state: "attached" });
    // Small settle pause — give React + wterm's ResizeObserver one frame
    // to finish wiring up before we start dispatching keys.
    await page.waitForTimeout(200);
    await ta.focus();
    // pressSequentially dispatches one key at a time targeted at the
    // element, which is more robust under flaky focus than keyboard.type.
    await ta.pressSequentially("uname -a\n");

    // Linux must appear in the rendered grid.
    await expect(page.locator(".wterm .term-grid")).toContainText(/Linux/i, {
      timeout: 30_000,
    });
  });
});
