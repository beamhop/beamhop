#!/usr/bin/env bash
# Stages everything `tauri build` needs into apps/tauri/:
#   binaries/bun-<target>                          # bun sidecar
#   resources/host/server.js                        # bundled host
#   resources/host/node_modules/microsandbox/       # SDK
#   resources/host/node_modules/@superradcompany/microsandbox-darwin-arm64/
#   resources/web/dist/                             # built UI mirror
#
# Why this layout: bun build --compile does not embed `.node` native
# bindings, which microsandbox needs. Instead we ship the Bun runtime
# (as a Tauri sidecar) + the JS bundle + the native package, and have
# Rust spawn `bun server.js` from the resources dir at startup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI="$ROOT/apps/tauri"
HOST_RES="$TAURI/resources/host"
WEB_RES="$TAURI/resources/web"
BIN_DIR="$TAURI/binaries"

BUN_BIN="${BUN_BIN:-$(command -v bun)}"
if [[ -z "${BUN_BIN}" || ! -x "${BUN_BIN}" ]]; then
  echo "prepare-tauri: cannot locate bun binary (set BUN_BIN to override)" >&2
  exit 1
fi

TARGET="${TAURI_TARGET:-aarch64-apple-darwin}"

echo "==> building web UI"
bun --filter @beamhop/web build

echo "==> building host bundle"
bun --filter @beamhop/host build

echo "==> staging bun sidecar at $BIN_DIR/bun-$TARGET"
mkdir -p "$BIN_DIR"
rm -f "$BIN_DIR/bun-"*
cp "$BUN_BIN" "$BIN_DIR/bun-$TARGET"
chmod +x "$BIN_DIR/bun-$TARGET"

echo "==> staging host resources at $HOST_RES"
rm -rf "$HOST_RES"
mkdir -p "$HOST_RES/node_modules/@superradcompany"
cp "$ROOT/apps/host/dist/server.js" "$HOST_RES/server.js"

# -L follows the workspace symlinks so the SDK becomes a real
# directory inside the bundle.
cp -RL "$ROOT/apps/host/node_modules/microsandbox" \
       "$HOST_RES/node_modules/microsandbox"

NATIVE_SRC=$(find "$ROOT/node_modules/.bun" -maxdepth 4 \
  -path '*/@superradcompany/microsandbox-darwin-arm64' -type d | head -n1)
if [[ -z "$NATIVE_SRC" ]]; then
  echo "prepare-tauri: cannot find @superradcompany/microsandbox-darwin-arm64 in node_modules" >&2
  exit 1
fi
cp -RL "$NATIVE_SRC" \
       "$HOST_RES/node_modules/@superradcompany/microsandbox-darwin-arm64"

echo "==> staging web dist at $WEB_RES/dist"
rm -rf "$WEB_RES"
mkdir -p "$WEB_RES"
cp -R "$ROOT/apps/web/dist" "$WEB_RES/dist"

echo "==> done"
du -sh "$HOST_RES" "$WEB_RES" "$BIN_DIR/bun-$TARGET" 2>/dev/null || true
