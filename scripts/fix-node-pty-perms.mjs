// node-pty's prebuilt spawn-helper sometimes loses its executable bit during install.
// Without +x, posix_spawnp fails at runtime. Idempotent, silent on success.
import { execSync } from "node:child_process";

try {
  execSync(
    "chmod +x ./node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true",
    { stdio: "ignore" },
  );
} catch {
  // best-effort
}
