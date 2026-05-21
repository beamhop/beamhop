// Boot the bundled default snapshot and run a battery of checks inside it
// to prove the image is actually usable — not just that the build exited 0.
//
// Exits 0 if every check passes, non-zero otherwise.

import { SandboxImage } from "@beamhop/beambox";
import { DEFAULT_TAG } from "../src/index.ts";

interface Check {
  name: string;
  argv: string[];
  /** Optional substring the stdout must contain for the check to pass. */
  expect?: string;
  /** Run as the given user via `sudo -u <user>` (default: image USER = dev). */
  asRoot?: boolean;
}

const checks: Check[] = [
  { name: "whoami(dev)", argv: ["whoami"], expect: "dev" },
  { name: "shell-is-zsh", argv: ["sh", "-c", "echo $SHELL"], expect: "zsh" },
  { name: "zsh-binary", argv: ["which", "zsh"], expect: "/usr/bin/zsh" },
  { name: "claude-version", argv: ["claude", "--version"] },
  { name: "claude-code-acp-help", argv: ["claude-code-acp", "--help"] },
  { name: "pi-acp-help", argv: ["pi-acp", "--help"] },
  { name: "bun-version", argv: ["bun", "--version"] },
  { name: "node-version", argv: ["node", "--version"] },
  { name: "git-version", argv: ["git", "--version"] },
  { name: "sudo-passwordless", argv: ["sudo", "-n", "true"] },
  { name: "motd-present", argv: ["cat", "/home/dev/.motd"], expect: "beamhop" },
  {
    name: "oh-my-zsh-installed",
    argv: ["test", "-d", "/home/dev/.oh-my-zsh"],
  },
];

async function main() {
  console.error(`[smoke-test] booting snapshot for tag ${DEFAULT_TAG}`);
  const img = await SandboxImage.fromDockerfileString(
    `FROM ${DEFAULT_TAG}\n`,
  ).build(DEFAULT_TAG, {
    // Reuse cache: this re-resolves to the existing snapshot, no rebuild.
    memory: 2048,
    quiet: true,
  });

  let failures = 0;
  for (const c of checks) {
    process.stderr.write(`  ${c.name.padEnd(28)} `);
    try {
      const out = await img.exec(c.argv, { throwOnNonZero: false, memory: 2048 });
      const stdout = out.stdout().trim();
      const stderr = out.stderr().trim();
      if (out.code !== 0) {
        failures++;
        process.stderr.write(`FAIL exit=${out.code}\n`);
        if (stderr) process.stderr.write(`    stderr: ${stderr.slice(0, 240)}\n`);
        continue;
      }
      if (c.expect && !stdout.includes(c.expect) && !stderr.includes(c.expect)) {
        failures++;
        process.stderr.write(`FAIL expected substring "${c.expect}"\n`);
        process.stderr.write(`    stdout: ${stdout.slice(0, 240)}\n`);
        continue;
      }
      const preview = (stdout || stderr).split("\n")[0]?.slice(0, 80) ?? "";
      process.stderr.write(`ok ${preview}\n`);
    } catch (err) {
      failures++;
      process.stderr.write(
        `ERROR ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  if (failures === 0) {
    console.error(`\n[smoke-test] all ${checks.length} checks passed.`);
  } else {
    console.error(
      `\n[smoke-test] ${failures}/${checks.length} checks failed.`,
    );
    process.exitCode = 1;
  }
}

void main().catch((err) => {
  console.error(
    `[smoke-test] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
