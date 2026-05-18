import { test, expect, type Page } from "@playwright/test";
import { test as strictTest } from "../fixtures/strict-page.js";

/**
 * Model chooser: header chip shows the current model; opening lists every
 * advertised model; clicking switches the agent. Covers both wire channels
 * (standard `availableModels` on claude-code, opencode-style configOptions
 * on copilot). Rejection paths surface inside the menu without freezing.
 */

async function bootReady(page: Page) {
  await page.goto("/");
  await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });
}

async function waitForChipReady(page: Page) {
  // The header may render the disabled stub for a moment before the gateway's
  // ready frame arrives with the modelCatalog. Wait for the chip to flip to
  // supported=true.
  await expect(page.getByTestId("model-chip")).toHaveAttribute(
    "data-model-supported",
    "true",
    { timeout: 8000 },
  );
}

strictTest.describe("model chooser", () => {
  strictTest("on a standard-channel agent: chip shows current model + dropdown lists all", async ({
    page,
    violations,
  }) => {
    await bootReady(page);
    // Default agent is claude-code → advertises standard `availableModels`.
    await waitForChipReady(page);
    const chip = page.getByTestId("model-chip");
    await expect(chip).toHaveAttribute("data-current-model", "alpha");

    await page.getByTestId("model-chip-trigger").click();
    const menu = page.getByTestId("model-menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-model-id="alpha"]')).toBeVisible();
    await expect(menu.locator('[data-model-id="beta"]')).toBeVisible();
    await expect(menu.locator('[data-model-id="omega"]')).toBeVisible();
    void violations;
  });

  strictTest("clicking a different model updates the chip", async ({ page, violations }) => {
    await bootReady(page);
    await waitForChipReady(page);
    await page.getByTestId("model-chip-trigger").click();
    await page.getByTestId("model-menu").locator('[data-model-id="beta"]').click();
    await expect(page.getByTestId("model-chip")).toHaveAttribute(
      "data-current-model",
      "beta",
      { timeout: 5000 },
    );
    void violations;
  });

  strictTest("agent-rejected model: chip stays on previous, error appears in menu", async ({
    page,
    violations,
  }) => {
    await bootReady(page);
    await waitForChipReady(page);
    await page.getByTestId("model-chip-trigger").click();
    // The fake-agent hard-rejects "omega".
    await page.getByTestId("model-menu").locator('[data-model-id="omega"]').click();
    // Chip stays on alpha (or whatever was current — never flips to omega).
    await expect(page.getByTestId("model-chip")).not.toHaveAttribute(
      "data-current-model",
      "omega",
      { timeout: 3000 },
    );
    // Re-open to see the rejection. The error block renders inside the menu.
    await page.getByTestId("model-chip-trigger").click();
    await expect(page.getByText(/last rejection/i)).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/not in your plan/i)).toBeVisible();
    void violations;
  });

  strictTest("on an opencode-channel agent: dropdown lists configOptions", async ({
    page,
    violations,
  }) => {
    await bootReady(page);
    // Switch to copilot — wired to advertise opencode-style configOptions.
    await page.locator('button[data-agent-id="copilot"]').click();
    await expect(page.locator('button[data-agent-id="copilot"]')).toHaveAttribute(
      "data-agent-active",
      "true",
      { timeout: 5000 },
    );
    await waitForChipReady(page);
    await page.getByTestId("model-chip-trigger").click();
    const menu = page.getByTestId("model-menu");
    await expect(menu.locator('[data-model-id="provider/foo"]')).toBeVisible();
    await expect(menu.locator('[data-model-id="provider/bar"]')).toBeVisible();
    void violations;
  });

  strictTest("picking a model on the opencode channel updates the chip", async ({
    page,
    violations,
  }) => {
    await bootReady(page);
    await page.locator('button[data-agent-id="copilot"]').click();
    await expect(page.locator('button[data-agent-id="copilot"]')).toHaveAttribute(
      "data-agent-active",
      "true",
      { timeout: 5000 },
    );
    await waitForChipReady(page);
    await page.getByTestId("model-chip-trigger").click();
    await page.getByTestId("model-menu").locator('[data-model-id="provider/bar"]').click();
    await expect(page.getByTestId("model-chip")).toHaveAttribute(
      "data-current-model",
      "provider/bar",
      { timeout: 5000 },
    );
    void violations;
  });

  strictTest("agents without models render the disabled chip", async ({ page, violations }) => {
    await bootReady(page);
    // gemini in e2e mode has no FAKE_AGENT_MODELS env → no model surface.
    await page.locator('button[data-agent-id="gemini"]').click();
    await expect(page.locator('button[data-agent-id="gemini"]')).toHaveAttribute(
      "data-agent-active",
      "true",
      { timeout: 5000 },
    );
    // Chip should be in unsupported state.
    await expect(page.getByTestId("model-chip")).toHaveAttribute(
      "data-model-supported",
      "false",
      { timeout: 8000 },
    );
    void violations;
  });
});

// Silence the unused base-test imports — strictTest is the one we use.
void test;
void expect;
