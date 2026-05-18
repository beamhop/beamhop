import { test, expect, type Page } from "@playwright/test";
import { test as strictTest } from "../fixtures/strict-page.js";

/**
 * Slash command menu: agent advertises `available_commands_update` after
 * session/new; UI shows a picker when the user types `/`; selecting an item
 * inserts `/<name> ` into the composer; submitting sends the literal string
 * via the standard prompt path.
 *
 * Helper: bring the page to a stable state with the slash menu OPEN and the
 * full catalog already loaded. Every test needs this; doing it inline made the
 * suite race-prone.
 */
async function openMenuWithCatalog(page: Page) {
  await page.goto("/");
  await expect(page.locator("text=ready").first()).toBeVisible({ timeout: 8000 });
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill("/");
  // Wait until the catalog has actually arrived before any arrow/enter
  // assertions — otherwise we'd race the WS roundtrip that delivers
  // `available_commands_update`.
  await expect(
    page.getByTestId("slash-menu").locator('[data-slash-command="init"]'),
  ).toBeVisible({ timeout: 10_000 });
  return composer;
}

strictTest.describe("slash commands", () => {
  strictTest("menu lists the agent's commands", async ({ page, violations }) => {
    await openMenuWithCatalog(page);
    const menu = page.getByTestId("slash-menu");
    await expect(menu.locator('[data-slash-command="init"]')).toBeVisible();
    await expect(menu.locator('[data-slash-command="review"]')).toBeVisible();
    await expect(menu.locator('[data-slash-command="compact"]')).toBeVisible();
    void violations;
  });

  strictTest("typing filters the menu by name prefix", async ({ page, violations }) => {
    const composer = await openMenuWithCatalog(page);
    await composer.fill("/re");
    const menu = page.getByTestId("slash-menu");
    await expect(menu.locator('[data-slash-command="review"]')).toBeVisible();
    await expect(menu.locator('[data-slash-command="init"]')).toHaveCount(0);
    await expect(menu.locator('[data-slash-command="compact"]')).toHaveCount(0);
    void violations;
  });

  strictTest("clicking an item inserts /<name> and closes the menu", async ({
    page,
    violations,
  }) => {
    const composer = await openMenuWithCatalog(page);
    await page.getByTestId("slash-menu").locator('[data-slash-command="init"]').click();
    await expect(composer).toHaveValue("/init ");
    await expect(page.getByTestId("slash-menu")).toHaveCount(0);
    void violations;
  });

  strictTest("Enter selects the first item by default", async ({ page, violations }) => {
    const composer = await openMenuWithCatalog(page);
    await composer.press("Enter");
    await expect(composer).toHaveValue("/init ");
    void violations;
  });

  strictTest("ArrowDown then Enter picks the second item", async ({ page, violations }) => {
    const composer = await openMenuWithCatalog(page);
    await composer.press("ArrowDown");
    await composer.press("Enter");
    await expect(composer).toHaveValue("/review ");
    void violations;
  });

  strictTest(
    "submitting a slash command sends the literal /name text and completes",
    async ({ page, violations }) => {
      const composer = await openMenuWithCatalog(page);
      await composer.fill("/init");
      // /init is the only match now, still the first item, press Enter to insert.
      await composer.press("Enter");
      await expect(composer).toHaveValue("/init ");
      await composer.press("Meta+Enter");
      // The literal text appears in the user turn (substring match).
      await expect(page.getByText("/init", { exact: false })).toBeVisible();
      await expect(page.getByText("end_turn")).toBeVisible({ timeout: 8000 });
      void violations;
    },
  );

  strictTest("menu disappears when input is past the slash token", async ({
    page,
    violations,
  }) => {
    const composer = await openMenuWithCatalog(page);
    // Add a space — caret is now past the command token, menu should hide.
    await composer.fill("/init ");
    await expect(page.getByTestId("slash-menu")).toHaveCount(0);
    // Free-form text doesn't open the menu either.
    await composer.fill("hello");
    await expect(page.getByTestId("slash-menu")).toHaveCount(0);
    void violations;
  });
});

// Silence the unused `test`/`expect` imports — we use the strict-page versions.
void test;
void expect;
