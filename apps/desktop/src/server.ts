// Dev server for the desktop UI. In production this app is wrapped by Tauri,
// which exposes the sidecar port via `window.__BEAMHOP_SIDECAR_PORT__`.
//
// For dev outside Tauri, run `bun run dev:sidecar` separately and pass
// `?sidecarPort=N` when opening the page (the sidecar prints its port on
// stdout's first line).

import index from "./index.html";

const port = Number(process.env.PORT ?? 5175);

const server = Bun.serve({
  port,
  development: true,
  routes: {
    "/": index,
  },
  fetch() {
    return new Response("not found", { status: 404 });
  },
});

console.log(`desktop dev server: http://localhost:${server.port}`);
console.log(
  `(in dev, append ?sidecarPort=N where N is what the sidecar printed)`,
);
