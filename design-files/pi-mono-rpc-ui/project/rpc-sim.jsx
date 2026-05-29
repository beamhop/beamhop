/* ============================================================
   rpc-sim.jsx — simulated pi RPC event stream + seed data
   Everything attaches to window for cross-file use.
   ============================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _id = 0;
const uid = (p = "id") => `${p}_${(++_id).toString(36)}${Date.now().toString(36).slice(-3)}`;

/* ---------------- Models (real pi-ai shapes) ---------------- */
const PI_MODELS = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", api: "anthropic-messages",
    reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 16384,
    cost: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 } },
  { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "anthropic", api: "anthropic-messages",
    reasoning: true, input: ["text", "image"], contextWindow: 200000, maxTokens: 32000,
    cost: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 } },
  { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", api: "openai-responses",
    reasoning: true, input: ["text", "image"], contextWindow: 400000, maxTokens: 64000,
    cost: { input: 2.5, output: 10.0, cacheRead: 0.25, cacheWrite: 0 } },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", api: "google-generative-ai",
    reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 65000,
    cost: { input: 1.25, output: 10.0, cacheRead: 0.31, cacheWrite: 0 } },
  { id: "qwen3-coder-480b", name: "Qwen3 Coder 480B", provider: "openrouter", api: "openai-completions",
    reasoning: false, input: ["text"], contextWindow: 262000, maxTokens: 32000,
    cost: { input: 0.4, output: 1.6, cacheRead: 0, cacheWrite: 0 } },
];
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const PROVIDER_DOT = { anthropic: "var(--amber)", openai: "var(--green)", google: "var(--blue)", openrouter: "var(--violet)" };

/* ---------------- Seed sessions (history rail) ---------------- */
const SEED_SESSIONS = [
  { id: "s_rate", name: "rate-limiter middleware", cwd: "~/code/api-gateway", model: "Claude Sonnet 4",
    provider: "anthropic", updated: "now", cost: 0.4127, msgs: 14, active: true },
  { id: "s_flaky", name: "fix flaky auth tests", cwd: "~/code/api-gateway", model: "Claude Sonnet 4",
    provider: "anthropic", updated: "32m", cost: 0.1903, msgs: 22 },
  { id: "s_migrate", name: "pg → drizzle migration", cwd: "~/code/api-gateway", model: "GPT-5.1",
    provider: "openai", updated: "3h", cost: 1.284, msgs: 47 },
  { id: "s_web", name: "landing redesign", cwd: "~/code/marketing-site", model: "Claude Sonnet 4",
    provider: "anthropic", updated: "yesterday", cost: 0.872, msgs: 31 },
  { id: "s_infra", name: "terraform drift audit", cwd: "~/code/infra", model: "Gemini 2.5 Pro",
    provider: "google", updated: "2d", cost: 0.341, msgs: 9 },
  { id: "s_cli", name: "argparse → clipanion", cwd: "~/code/devtools", model: "Qwen3 Coder 480B",
    provider: "openrouter", updated: "4d", cost: 0.0612, msgs: 18 },
];

/* ---------------- Branch tree for the active session ---------------- */
const SEED_TREE = [
  { id: "n1", label: "scaffold rate limiter", kind: "user", depth: 0 },
  { id: "n2", label: "token-bucket impl", kind: "user", depth: 0 },
  { id: "n3", label: "↳ sliding-window variant", kind: "fork", depth: 1, branch: true },
  { id: "n4", label: "wire into middleware", kind: "user", depth: 0, current: true },
  { id: "n5", label: "add Redis backend", kind: "user", depth: 0, future: true },
];

/* ---------------- Seed transcript (already-present messages) ---------------- */
const SEED_MESSAGES = [
  {
    id: uid("m"), role: "user", ts: Date.now() - 1000 * 60 * 9,
    text: "Add a token-bucket rate limiter as Express middleware. 100 req/min per IP, return 429 with a Retry-After header.",
  },
  {
    id: uid("m"), role: "assistant", ts: Date.now() - 1000 * 60 * 8, model: "Claude Sonnet 4",
    stopReason: "toolUse",
    usage: { input: 4210, output: 612, cacheRead: 18400, cacheWrite: 0, cost: 0.0218 },
    blocks: [
      { type: "thinking", text: "I'll start by reading the existing middleware setup to match the project's conventions before writing anything new.", collapsed: true },
      { type: "text", text: "I'll add the rate limiter. First, let me look at how middleware is currently wired up." },
      { type: "toolCall", name: "read", status: "done", args: { path: "src/middleware/index.ts" },
        output: "export { cors } from './cors';\nexport { logger } from './logger';\nexport { auth } from './auth';\n// 3 middleware registered in app.ts", lines: 4 },
      { type: "toolCall", name: "grep", status: "done", args: { pattern: "app.use\\(", path: "src/" },
        output: "src/app.ts:18:  app.use(cors());\nsrc/app.ts:19:  app.use(logger);\nsrc/app.ts:21:  app.use(auth);", lines: 3 },
    ],
  },
  {
    id: uid("m"), role: "assistant", ts: Date.now() - 1000 * 60 * 7, model: "Claude Sonnet 4",
    stopReason: "stop",
    usage: { input: 5120, output: 1840, cacheRead: 22600, cacheWrite: 1200, cost: 0.0412 },
    blocks: [
      { type: "text", text: "The pattern is clear — plain function middleware registered in `app.ts`. I'll create `src/middleware/rate-limit.ts` with an in-memory token bucket and register it after `cors`." },
      { type: "toolCall", name: "write", status: "done", args: { path: "src/middleware/rate-limit.ts" },
        output: "+ 38 lines written", lines: 38, diff: { add: 38, del: 0 } },
      { type: "toolCall", name: "edit", status: "done", args: { path: "src/app.ts" },
        output: "@@ -19,6 +19,7 @@\n   app.use(logger);\n+  app.use(rateLimit({ windowMs: 60_000, max: 100 }));\n   app.use(auth);", lines: 3, diff: { add: 1, del: 0 } },
      { type: "text", text: "Done. The limiter tracks 100 requests/minute per IP and responds `429` with a `Retry-After` header once the bucket is empty. Want me to add a Redis-backed store so it works across multiple instances?" },
    ],
  },
];

/* ============================================================
   Scenario scripts — what the agent "does" on the next prompt.
   Each returns an array of steps the runner plays out.
   ============================================================ */
function scenarioRedis() {
  return [
    { t: "think", text: "They want a distributed store. Redis with INCR + EXPIRE is the standard approach. I should check if ioredis is already a dependency before adding it, and guard the dangerous install behind confirmation." },
    { t: "say", text: "Good call — the in-memory bucket won't hold across instances. Let me check whether a Redis client is already available, then swap the store." },
    { t: "tool", name: "read", args: { path: "package.json" }, dur: 700,
      output: '"dependencies": {\n  "express": "^4.19.2",\n  "pino": "^9.3.0"\n}\n// no redis client present' },
    { t: "say", text: "No Redis client yet. I'll install `ioredis` — this touches your lockfile, so I'll ask first." },
    { t: "dialog", method: "confirm", title: "Run install command?",
      message: "npm install ioredis@5 — modifies package.json and package-lock.json", cmd: "npm install ioredis@5" },
    { t: "afterDialog" },
  ];
}
function scenarioTests() {
  return [
    { t: "think", text: "Before shipping I should add coverage. I'll write a vitest spec that exhausts the bucket and asserts the 429 + Retry-After, then run the suite." },
    { t: "say", text: "Let me add a test that drains the bucket and verifies the 429 response, then run the suite." },
    { t: "tool", name: "write", args: { path: "test/rate-limit.test.ts" }, dur: 900,
      output: "+ 41 lines written", diff: { add: 41, del: 0 } },
    { t: "tool", name: "bash", args: { command: "npx vitest run test/rate-limit.test.ts" }, dur: 2600,
      stream: ["RUN  v2.1.4  ~/code/api-gateway\n", "\n ✓ test/rate-limit.test.ts (3)\n",
        "   ✓ allows requests under the limit\n", "   ✓ returns 429 once the bucket empties\n",
        "   ✓ sets Retry-After to remaining window\n", "\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  1.84s\n"] },
    { t: "say", text: "All three pass. The limiter is covered: under-limit requests flow through, the 429 fires when the bucket empties, and `Retry-After` reflects the remaining window." },
  ];
}
function scenarioGeneric(prompt) {
  return [
    { t: "think", text: `Parsing the request: "${prompt.slice(0, 80)}". I'll locate the relevant code, make a focused change, and verify it compiles before reporting back.` },
    { t: "say", text: "On it. Let me find the relevant code first." },
    { t: "tool", name: "grep", args: { pattern: prompt.split(" ")[0] || "TODO", path: "src/" }, dur: 800,
      output: "src/app.ts:21:  app.use(auth);\nsrc/middleware/rate-limit.ts:1:export function rateLimit(opts) {" },
    { t: "tool", name: "edit", args: { path: "src/middleware/rate-limit.ts" }, dur: 1100,
      output: "@@ -12,3 +12,7 @@ applied", diff: { add: 6, del: 2 } },
    { t: "tool", name: "bash", args: { command: "npx tsc --noEmit" }, dur: 1900,
      stream: ["tsc --noEmit\n", "\n", "✓ no type errors\n"] },
    { t: "say", text: "Change applied and the project type-checks clean. Let me know if you'd like tests or a different approach." },
  ];
}
const SCENARIOS = [scenarioRedis, scenarioTests, scenarioGeneric];

/* expose */
Object.assign(window, {
  sleep, uid, PI_MODELS, THINKING_LEVELS, PROVIDER_DOT,
  SEED_SESSIONS, SEED_TREE, SEED_MESSAGES, SCENARIOS,
  scenarioRedis, scenarioTests, scenarioGeneric,
});
