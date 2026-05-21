// Build the bundled default sandbox image end-to-end so we can verify the
// Dockerfile actually produces a snapshot before users hit it from the
// desktop dialog. Streams every step to stderr; exits non-zero on failure.
//
// Usage:
//   bun packages/default-sandbox-image/scripts/build-image.ts [--memory 2048]

import { SandboxImage } from "@beamhop/beambox";
import {
  DEFAULT_DOCKERFILE,
  DEFAULT_TAG,
  getDefaultContextDir,
} from "../src/index.ts";

function parseArgs(): { memory: number } {
  let memory = 2048;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--memory" && process.argv[i + 1]) {
      memory = Number(process.argv[++i]);
    }
  }
  return { memory };
}

async function main() {
  const { memory } = parseArgs();
  const contextDir = getDefaultContextDir();
  console.error(`[build-image] tag=${DEFAULT_TAG} context=${contextDir} memory=${memory}`);

  const started = Date.now();
  const stepStart = new Map<number, number>();

  try {
    const img = await SandboxImage.fromDockerfileString(DEFAULT_DOCKERFILE).build(
      DEFAULT_TAG,
      {
        contextDir,
        memory,
        onEvent: (ev) => {
          switch (ev.kind) {
            case "build:start":
              console.error(
                `[build:start] tag=${ev.tag} snapshot=${ev.snapshotName} steps=${ev.steps} cached=${ev.cached}`,
              );
              break;
            case "step:start":
              stepStart.set(ev.index, Date.now());
              console.error(`[step:start ${ev.index}] ${ev.label}`);
              break;
            case "step:stdout":
              process.stderr.write(ev.text);
              break;
            case "step:stderr":
              process.stderr.write(ev.text);
              break;
            case "step:end": {
              const ms = Date.now() - (stepStart.get(ev.index) ?? Date.now());
              console.error(
                `[step:end ${ev.index}] exit=${ev.exitCode} (${ms}ms)`,
              );
              break;
            }
            case "build:end":
              console.error(
                `[build:end] snapshot=${ev.snapshotName} cached=${ev.cached}`,
              );
              break;
            case "build:error":
              console.error(
                `[build:error] ${ev.message}` +
                  (ev.stepIndex !== undefined ? ` (step ${ev.stepIndex})` : ""),
              );
              break;
          }
        },
      },
    );
    const totalMs = Date.now() - started;
    console.error(
      `\n[ok] snapshot=${img.snapshotName} digest=${img.digest} in ${(totalMs / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const totalMs = Date.now() - started;
    console.error(`\n[fail] after ${(totalMs / 1000).toFixed(1)}s: ${msg}`);
    process.exitCode = 1;
  }
}

void main();
