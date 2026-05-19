import { expect, test } from "@playwright/test";
import { startSidecar, type SidecarHandle } from "./_sidecar.ts";

const skip = !process.env.RUN_INTEGRATION;
test.describe.configure({ mode: "serial" });

/**
 * Negative-case companion to opencode-flow.spec.ts.
 *
 * Builds a `FROM oven/bun` image and tries to start an agent whose binary
 * isn't available — we use the gemini built-in (command: "gemini", no
 * bunx wrapper). The gateway should fail to spawn the agent and the chat
 * UI should surface a fatal error banner rather than spinning forever or
 * silently dying.
 *
 * Guards two regressions specifically:
 *   - the host-side `defaultHealthCheck` returning false-positive for
 *     sandbox-bound agents (we'd see the right error, but for the wrong
 *     reason — the host probe instead of the actual spawn)
 *   - spawn errors getting swallowed and producing an indefinite
 *     "connecting…" state
 *
 * Why not opencode itself: opencode now runs via `bunx -y --package=opencode-ai`,
 * which fetches the package on demand. FROM oven/bun → bunx works → no
 * failure to verify. We need an agent the sandbox genuinely can't run.
 */
test.describe("missing-binary agent: chat surfaces install error", () => {
  test.skip(
    skip,
    "set RUN_INTEGRATION=1 to run (boots a real microVM)",
  );

  let sidecar: SidecarHandle;

  test.beforeAll(async () => {
    sidecar = await startSidecar();
  });

  test.afterAll(async () => {
    if (sidecar) await sidecar.shutdown();
  });

  test("FROM oven/bun + start gemini (no binary) → agent-error visible", async ({
    page,
  }) => {
    page.setDefaultTimeout(60_000);

    await page.goto(`/?sidecarPort=${sidecar.port}`);
    await expect(page.getByText("sidecar · live")).toBeVisible({
      timeout: 30_000,
    });

    // -- build a bare bun image -----------------------------------------
    const tag = "beamhop-e2e/missing-agent:test";
    const dockerfile = "FROM oven/bun\n";

    await page.getByTestId("new-sandbox").click();
    await page.getByRole("button", { name: /build from dockerfile/i }).click();
    await page.getByTestId("build-tag-input").fill(tag);
    await page.getByTestId("dockerfile-input").fill(dockerfile);
    await page.getByTestId("confirm-create").click();

    await expect(
      page.locator("[data-testid^='sandbox-sb_']").first(),
    ).toBeVisible({ timeout: 180_000 });

    // -- start gemini (binary doesn't exist in the sandbox) -------------
    await page.getByTestId("agent-picker").selectOption("gemini");
    await page.getByTestId("start-agent").click();

    await expect(page.getByTestId("live-agent")).toBeVisible({
      timeout: 30_000,
    });

    // -- the error banner must appear with the right diagnostic ---------
    // Two close codes are valid "agent unusable" signals depending on the
    // spawn path:
    //   - `agent_not_installed` (4501): direct exec returned ENOENT
    //     synchronously. Happens for absolute-path commands missing from
    //     the sandbox.
    //   - `agent_crashed` (4500): we routed through `/bin/sh -c <cmd>`
    //     for PATH lookup; the shell exits 127 when the command is
    //     missing, which the gateway sees as a non-zero exit (crash).
    // Either way the user gets a clear, fast failure — which is what
    // matters. The exact code can change as the spawn path evolves; this
    // test pins the user-facing contract, not the wire detail.
    const errorBanner = page.getByTestId("agent-error");
    await expect(errorBanner).toBeVisible({ timeout: 60_000 });
    await expect(errorBanner).toContainText(/agent_(not_installed|crashed)/i);

    // -- composer must NOT be interactable -------------------------------
    // If this passes, we accidentally connected to a non-existent binary
    // (which would mean the previous health-check regression came back in
    // a different shape, or the error path doesn't actually fail-fast).
    const composer = page.getByTestId("agent-prompt-input");
    await expect(composer).toBeDisabled();
  });
});
