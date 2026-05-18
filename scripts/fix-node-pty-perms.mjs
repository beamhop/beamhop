// node-pty's prebuilt spawn-helper sometimes loses its executable bit during install.
// Without +x, posix_spawnp fails at runtime. Idempotent, silent on success.
//
// We chmod every spawn-helper anywhere under node_modules — covers both the
// hoisted location (./node_modules/node-pty/...) and Bun's content-addressed
// store under ./node_modules/.bun/node-pty@<version>/node_modules/node-pty/...
import { execSync } from "node:child_process";

try {
  execSync(
    "find ./node_modules -path '*/node-pty/prebuilds/*/spawn-helper' -exec chmod +x {} + 2>/dev/null || true",
    { stdio: "ignore" },
  );
} catch {
  // best-effort
}
