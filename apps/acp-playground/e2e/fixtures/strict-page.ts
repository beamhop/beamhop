import { test as base, type ConsoleMessage, type Request } from "@playwright/test";

/**
 * Strict console + network policy for the playground e2e suite.
 *
 * Every test gets a `page` that has already attached listeners to capture
 * console errors and failed network requests. At test teardown the fixture
 * asserts there were none — unless the test explicitly mutated the allowlist
 * via `violations.expectConsole(...)` / `violations.expectNetwork(...)` first.
 *
 * The point: silent regressions (a stray console.error, a 500 from the WS
 * upgrade) shouldn't ever ship green. If the SDK is the cause, fix the SDK;
 * if the message is genuinely benign, allowlist it explicitly with a comment.
 */

export interface CapturedConsole {
  type: "error" | "warning";
  text: string;
  location: string;
}

export interface CapturedNetwork {
  url: string;
  method: string;
  status: number;
  failure?: string;
}

export interface Violations {
  console: CapturedConsole[];
  network: CapturedNetwork[];
  /** Mark expected console messages so they don't fail the test. Matches as a substring. */
  expectConsole(...substrings: string[]): void;
  /** Mark expected failed-network URLs so they don't fail the test. Matches as a substring. */
  expectNetwork(...substrings: string[]): void;
}

// URLs we always tolerate failing (fonts CDN flakes, Bun dev infra).
const DEFAULT_NETWORK_ALLOWLIST = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "/_bun/unref",
  "/_bun/hmr",
];

// Console messages we always tolerate. Keep this list tight — the SDK's
// intentional dev warnings should appear here ONLY if they're truly benign.
const DEFAULT_CONSOLE_ALLOWLIST: string[] = [
  // React 19 strict-mode double-invoke warnings in dev are noisy but expected.
  // (none today)
];

export const test = base.extend<{ violations: Violations }>({
  violations: async ({ page }, use, testInfo) => {
    const consoleAllow = [...DEFAULT_CONSOLE_ALLOWLIST];
    const networkAllow = [...DEFAULT_NETWORK_ALLOWLIST];

    const captured = {
      console: [] as CapturedConsole[],
      network: [] as CapturedNetwork[],
    };

    const onConsole = (msg: ConsoleMessage) => {
      const t = msg.type();
      if (t !== "error" && t !== "warning") return;
      captured.console.push({
        type: t,
        text: msg.text(),
        location: formatLocation(msg.location()),
      });
    };

    const onResponse = (resp: Awaited<ReturnType<typeof page.waitForResponse>>) => {
      const status = resp.status();
      if (status < 400) return;
      captured.network.push({
        url: resp.url(),
        method: resp.request().method(),
        status,
      });
    };

    const onRequestFailed = (req: Request) => {
      captured.network.push({
        url: req.url(),
        method: req.method(),
        status: 0,
        failure: req.failure()?.errorText ?? "request failed",
      });
    };

    page.on("console", onConsole);
    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);

    const violations: Violations = {
      console: captured.console,
      network: captured.network,
      expectConsole(...substrings) {
        consoleAllow.push(...substrings);
      },
      expectNetwork(...substrings) {
        networkAllow.push(...substrings);
      },
    };

    await use(violations);

    page.off("console", onConsole);
    page.off("response", onResponse);
    page.off("requestfailed", onRequestFailed);

    const consoleErrors = captured.console.filter(
      (c) => c.type === "error" && !consoleAllow.some((a) => c.text.includes(a)),
    );
    const consoleWarnings = captured.console.filter(
      (c) => c.type === "warning" && !consoleAllow.some((a) => c.text.includes(a)),
    );
    const networkErrors = captured.network.filter(
      (n) => !networkAllow.some((a) => n.url.includes(a)),
    );

    // Surface warnings in the test report even when they don't fail the run —
    // a noisy SDK signals trouble even if nothing is technically broken yet.
    if (consoleWarnings.length > 0) {
      await testInfo.attach("console-warnings.json", {
        body: JSON.stringify(consoleWarnings, null, 2),
        contentType: "application/json",
      });
    }

    const failures: string[] = [];
    if (consoleErrors.length > 0) {
      failures.push(
        `\n[strict-page] ${consoleErrors.length} unexpected console.error:\n` +
          consoleErrors.map((c) => `  - ${c.text}  ${c.location}`).join("\n"),
      );
    }
    if (networkErrors.length > 0) {
      failures.push(
        `\n[strict-page] ${networkErrors.length} unexpected network failure:\n` +
          networkErrors
            .map((n) => `  - ${n.method} ${n.url} ${n.status || n.failure || ""}`)
            .join("\n"),
      );
    }
    if (failures.length > 0) {
      throw new Error(failures.join("\n"));
    }
  },
});

export { expect } from "@playwright/test";

function formatLocation(loc: { url?: string; lineNumber?: number; columnNumber?: number }): string {
  if (!loc.url) return "";
  return `(${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0})`;
}
