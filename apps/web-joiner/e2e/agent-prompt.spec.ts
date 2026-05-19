import { expect, test } from "@playwright/test";
import { startSmokeHost, type SmokeHostHandle } from "./_host.ts";

const skip = !process.env.RUN_INTEGRATION;
test.describe.configure({ mode: "serial" });

test.describe("M4 — share an agent session end-to-end", () => {
  test.skip(skip, "set RUN_INTEGRATION=1 to run (boots a real microVM)");

  let host: SmokeHostHandle;
  let agentUrl = "";

  test.beforeAll(async () => {
    host = await startSmokeHost();
    agentUrl = host.agentUrl;
  });

  test.afterAll(async () => {
    if (host) await host.shutdown();
  });

  test("joiner connects to the agent and sees a streamed response", async ({
    page,
  }) => {
    await page.goto(agentUrl);

    // Status chrome reports "live" once the ACP handshake settles.
    await expect(page.getByText(/^live$/)).toBeVisible({ timeout: 120_000 });

    const input = page.getByTestId("agent-prompt-input");
    await input.fill("ping");
    await page.getByTestId("agent-send").click();

    // The fake-agent fixture replies with a streamed update during the
    // session/prompt call. We don't care about exact text — just that an
    // agent message bubble appears with non-empty content.
    const agentMsg = page.getByTestId("msg-agent").first();
    await expect(agentMsg).toBeVisible({ timeout: 30_000 });
  });
});
