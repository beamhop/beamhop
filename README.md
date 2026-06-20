# beamhop

Branding website for Beamhop, a data-sovereign collaborative agent harness.

Built with **bun + vite + react + typescript**.

## Develop

```sh
bun install
bun run dev        # vite dev server on http://localhost:5180
```

## Other scripts

```sh
bun run build      # typecheck + production build to dist/
bun run preview    # serve the production build
bun run typecheck  # tsc --noEmit
```

The previous hand-written static site lives in `legacy-codes/` as reference
while the React version is rebuilt. Product and design notes are in
`PRODUCT.md`, `DESIGN.md`, `CONTEXT.md`, and `docs/adr/`.
