// Lets `import index from "../web/index.html"` typecheck. Bun resolves the
// HTML file to an HTMLBundle manifest at build/serve time.
declare module "*.html" {
  const content: import("bun").HTMLBundle;
  export default content;
}
