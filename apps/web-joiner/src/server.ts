// Dev server for the web-joiner SPA. In production this app is shipped as a
// static bundle (`bun run build` -> dist/). Here we use Bun's built-in fullstack
// server purely as a hot-reloading dev environment — no API routes.

import index from "./index.html";

const port = Number(process.env.PORT ?? 5174);

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

console.log(`web-joiner dev server: http://localhost:${server.port}`);
