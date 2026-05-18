import { describe, it } from "./_shim.js";
import assert from "./_shim.js";
import { applyRunOptions, parsePortSpec, parseVolumeSpec } from "../src/image-builder.js";
import type { ImageMetadata, RunOptions } from "../src/index.js";

// Records every method call made against it, then returns itself so the
// builder chain keeps working. `volume`'s second arg is a configure
// callback that receives a fresh MountBuilder recorder; we invoke it
// immediately so its call sequence is captured alongside the rest.
function makeRecorder(label = "sb"): {
  recorder: any;
  calls: Array<{ on: string; method: string; args: unknown[] }>;
} {
  const calls: Array<{ on: string; method: string; args: unknown[] }> = [];
  const proxy: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          if (label === "sb" && prop === "volume" && typeof args[1] === "function") {
            const { recorder: mountRec } = makeRecorderInto(calls, "mount");
            (args[1] as (b: any) => unknown)(mountRec);
            calls.push({ on: label, method: prop, args: [args[0]] });
            return proxy;
          }
          calls.push({ on: label, method: prop, args });
          return proxy;
        };
      },
    },
  );
  return { recorder: proxy, calls };
}

function makeRecorderInto(
  calls: Array<{ on: string; method: string; args: unknown[] }>,
  label: string,
) {
  const proxy: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          calls.push({ on: label, method: prop, args });
          return proxy;
        };
      },
    },
  );
  return { recorder: proxy };
}

const emptyMeta: Pick<
  ImageMetadata,
  "env" | "workdir" | "user" | "entrypoint" | "cmd"
> = {
  env: {},
  workdir: null,
  user: null,
  entrypoint: null,
  cmd: null,
};

const apply = (options: RunOptions, meta = emptyMeta) => {
  const { recorder, calls } = makeRecorder();
  applyRunOptions(recorder, meta, options);
  return calls;
};

describe("applyRunOptions", () => {
  it("forwards cpus and memory only when set", () => {
    const calls = apply({ name: "x", cpus: 4, memory: 1024 });
    assert.deepEqual(
      calls.map((c) => [c.method, c.args]),
      [
        ["cpus", [4]],
        ["memory", [1024]],
      ],
    );

    const none = apply({ name: "x" });
    assert.equal(none.length, 0);
  });

  it("merges options.env on top of metadata.env (caller wins)", () => {
    const calls = apply(
      { name: "x", env: { A: "from-caller", B: "new" } },
      { ...emptyMeta, env: { A: "from-image", C: "kept" } },
    );
    const envsCall = calls.find((c) => c.method === "envs");
    assert.ok(envsCall, "envs() should be called");
    assert.deepEqual(envsCall.args[0], { A: "from-caller", B: "new", C: "kept" });
  });

  it("skips envs() when neither image nor options provide any", () => {
    const calls = apply({ name: "x" });
    assert.ok(!calls.some((c) => c.method === "envs"));
  });

  it("prefers options over metadata for workdir/user, falls back to metadata", () => {
    const meta = { ...emptyMeta, workdir: "/img", user: "img-user" };
    const overridden = apply({ name: "x", workdir: "/opt", user: "opt-user" }, meta);
    assert.deepEqual(
      overridden.filter((c) => c.method === "workdir" || c.method === "user"),
      [
        { on: "sb", method: "workdir", args: ["/opt"] },
        { on: "sb", method: "user", args: ["opt-user"] },
      ],
    );

    const fallback = apply({ name: "x" }, meta);
    assert.deepEqual(
      fallback.filter((c) => c.method === "workdir" || c.method === "user"),
      [
        { on: "sb", method: "workdir", args: ["/img"] },
        { on: "sb", method: "user", args: ["img-user"] },
      ],
    );
  });

  it("entrypoint resolution: options → metadata.entrypoint → metadata.cmd → none", () => {
    const ep = ["node", "x.js"];
    const optsEp = apply({ name: "x", entrypoint: ["override"] }, {
      ...emptyMeta,
      entrypoint: ep,
      cmd: ["cmd"],
    });
    assert.deepEqual(
      optsEp.find((c) => c.method === "entrypoint")?.args[0],
      ["override"],
    );

    const metaEp = apply({ name: "x" }, { ...emptyMeta, entrypoint: ep, cmd: ["cmd"] });
    assert.deepEqual(metaEp.find((c) => c.method === "entrypoint")?.args[0], ep);

    const cmdFallback = apply({ name: "x" }, { ...emptyMeta, cmd: ["cmd"] });
    assert.deepEqual(cmdFallback.find((c) => c.method === "entrypoint")?.args[0], ["cmd"]);

    const none = apply({ name: "x" });
    assert.ok(!none.some((c) => c.method === "entrypoint"));
  });

  it("forwards hostname / maxDuration / idleTimeout when set", () => {
    const calls = apply({
      name: "x",
      hostname: "worker",
      maxDuration: 600,
      idleTimeout: 30,
    });
    assert.deepEqual(
      calls.map((c) => [c.method, c.args]),
      [
        ["hostname", ["worker"]],
        ["maxDuration", [600]],
        ["idleTimeout", [30]],
      ],
    );
  });

  describe("replace", () => {
    it("true → replace()", () => {
      const calls = apply({ name: "x", replace: true });
      assert.deepEqual(calls, [{ on: "sb", method: "replace", args: [] }]);
    });

    it("number → replaceWithGrace(ms) (back-compat)", () => {
      const calls = apply({ name: "x", replace: 5000 });
      assert.deepEqual(calls, [{ on: "sb", method: "replaceWithGrace", args: [5000] }]);
    });

    it("{ graceMs } → replaceWithGrace(ms)", () => {
      const calls = apply({ name: "x", replace: { graceMs: 5000 } });
      assert.deepEqual(calls, [{ on: "sb", method: "replaceWithGrace", args: [5000] }]);
    });

    it("false → no call (explicit opt-out)", () => {
      const calls = apply({ name: "x", replace: false });
      assert.equal(calls.length, 0);
    });

    it("undefined → no call", () => {
      const calls = apply({ name: "x" });
      assert.ok(!calls.some((c) => c.method.startsWith("replace")));
    });
  });

  describe("network", () => {
    it("false → disableNetwork()", () => {
      const calls = apply({ name: "x", network: false });
      assert.deepEqual(calls, [{ on: "sb", method: "disableNetwork", args: [] }]);
    });

    it("function → network(fn)", () => {
      const configure = (b: any) => b;
      const calls = apply({ name: "x", network: configure });
      assert.deepEqual(calls, [{ on: "sb", method: "network", args: [configure] }]);
    });

    it("undefined → no call", () => {
      const calls = apply({ name: "x" });
      assert.ok(!calls.some((c) => c.method === "disableNetwork" || c.method === "network"));
    });
  });

  describe("ports", () => {
    it("TCP by default", () => {
      const calls = apply({ name: "x", ports: [{ host: 8080, guest: 80 }] });
      assert.deepEqual(calls, [{ on: "sb", method: "port", args: [8080, 80] }]);
    });

    it("explicit tcp routes to port()", () => {
      const calls = apply({
        name: "x",
        ports: [{ host: 8080, guest: 80, protocol: "tcp" }],
      });
      assert.deepEqual(calls, [{ on: "sb", method: "port", args: [8080, 80] }]);
    });

    it("udp routes to portUdp()", () => {
      const calls = apply({
        name: "x",
        ports: [{ host: 5353, guest: 53, protocol: "udp" }],
      });
      assert.deepEqual(calls, [{ on: "sb", method: "portUdp", args: [5353, 53] }]);
    });

    it("preserves order across mixed protocols", () => {
      const calls = apply({
        name: "x",
        ports: [
          { host: 80, guest: 80 },
          { host: 53, guest: 53, protocol: "udp" },
          { host: 443, guest: 443 },
        ],
      });
      assert.deepEqual(
        calls.map((c) => [c.method, c.args]),
        [
          ["port", [80, 80]],
          ["portUdp", [53, 53]],
          ["port", [443, 443]],
        ],
      );
    });

    it("number shorthand maps host=guest", () => {
      const calls = apply({ name: "x", ports: [8080] });
      assert.deepEqual(calls, [{ on: "sb", method: "port", args: [8080, 8080] }]);
    });

    it("string shorthand: \"host:guest\" → TCP", () => {
      const calls = apply({ name: "x", ports: ["8080:80"] });
      assert.deepEqual(calls, [{ on: "sb", method: "port", args: [8080, 80] }]);
    });

    it("string shorthand: \"host:guest/udp\" → UDP", () => {
      const calls = apply({ name: "x", ports: ["5353:53/udp"] });
      assert.deepEqual(calls, [{ on: "sb", method: "portUdp", args: [5353, 53] }]);
    });

    it("mixed spec forms route correctly and preserve order", () => {
      const calls = apply({
        name: "x",
        ports: [8080, "5353:53/udp", { host: 443, guest: 443 }],
      });
      assert.deepEqual(
        calls.map((c) => [c.method, c.args]),
        [
          ["port", [8080, 8080]],
          ["portUdp", [5353, 53]],
          ["port", [443, 443]],
        ],
      );
    });
  });

  describe("volumes", () => {
    it("bind mount → bind()", () => {
      const calls = apply({
        name: "x",
        volumes: [{ guest: "/data", bind: "./data" }],
      });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "bind", ["./data"]],
          ["sb", "volume", ["/data"]],
        ],
      );
    });

    it("named volume → named()", () => {
      const calls = apply({
        name: "x",
        volumes: [{ guest: "/cache", volume: "build-cache" }],
      });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "named", ["build-cache"]],
          ["sb", "volume", ["/cache"]],
        ],
      );
    });

    it("tmpfs → tmpfs()", () => {
      const calls = apply({
        name: "x",
        volumes: [{ guest: "/tmp", tmpfs: true }],
      });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "tmpfs", []],
          ["sb", "volume", ["/tmp"]],
        ],
      );
    });

    it("readonly chains readonly() after source", () => {
      const calls = apply({
        name: "x",
        volumes: [{ guest: "/etc", bind: "./etc", readonly: true }],
      });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "bind", ["./etc"]],
          ["mount", "readonly", []],
          ["sb", "volume", ["/etc"]],
        ],
      );
    });

    it("string shorthand: bind", () => {
      const calls = apply({ name: "x", volumes: ["./data:/data"] });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "bind", ["./data"]],
          ["sb", "volume", ["/data"]],
        ],
      );
    });

    it("string shorthand: bind + :ro", () => {
      const calls = apply({ name: "x", volumes: ["./etc:/etc:ro"] });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "bind", ["./etc"]],
          ["mount", "readonly", []],
          ["sb", "volume", ["/etc"]],
        ],
      );
    });

    it("string shorthand: named volume (no leading . or /)", () => {
      const calls = apply({ name: "x", volumes: ["build-cache:/cache"] });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "named", ["build-cache"]],
          ["sb", "volume", ["/cache"]],
        ],
      );
    });

    it("string shorthand: tmpfs", () => {
      const calls = apply({ name: "x", volumes: ["tmpfs:/tmp"] });
      assert.deepEqual(
        calls.map((c) => [c.on, c.method, c.args]),
        [
          ["mount", "tmpfs", []],
          ["sb", "volume", ["/tmp"]],
        ],
      );
    });
  });

  it("doesn't touch builder when options + metadata are minimal", () => {
    const calls = apply({ name: "x" });
    assert.equal(calls.length, 0);
  });
});

describe("parsePortSpec", () => {
  it("number → host=guest, no protocol", () => {
    assert.deepEqual(parsePortSpec(8080), { host: 8080, guest: 8080 });
  });

  it("\"host:guest\" → TCP (no protocol field)", () => {
    assert.deepEqual(parsePortSpec("8080:80"), { host: 8080, guest: 80 });
  });

  it("\"host:guest/udp\" → udp", () => {
    assert.deepEqual(parsePortSpec("5353:53/udp"), { host: 5353, guest: 53, protocol: "udp" });
  });

  it("\"host:guest/tcp\" is valid but normalizes to no protocol", () => {
    assert.deepEqual(parsePortSpec("8080:80/tcp"), { host: 8080, guest: 80 });
  });

  it("object is passed through unchanged", () => {
    const o = { host: 1, guest: 2, protocol: "udp" as const };
    assert.equal(parsePortSpec(o), o);
  });

  it("rejects garbage", () => {
    assert.throws(() => parsePortSpec("nope"), /invalid port spec/);
    assert.throws(() => parsePortSpec("a:b"), /must be numbers/);
    assert.throws(() => parsePortSpec("8080:80/sctp"), /protocol must be tcp or udp/);
    assert.throws(() => parsePortSpec("8080:"), /invalid port spec/);
  });
});

describe("parseVolumeSpec", () => {
  it("./path:/guest → bind", () => {
    assert.deepEqual(parseVolumeSpec("./data:/data"), { guest: "/data", bind: "./data" });
  });

  it("/abs:/guest → bind", () => {
    assert.deepEqual(parseVolumeSpec("/srv/data:/data"), { guest: "/data", bind: "/srv/data" });
  });

  it("name:/guest → named volume", () => {
    assert.deepEqual(parseVolumeSpec("build-cache:/cache"), {
      guest: "/cache",
      volume: "build-cache",
    });
  });

  it("tmpfs:/guest → tmpfs", () => {
    assert.deepEqual(parseVolumeSpec("tmpfs:/tmp"), { guest: "/tmp", tmpfs: true });
  });

  it(":ro suffix sets readonly on bind", () => {
    assert.deepEqual(parseVolumeSpec("./etc:/etc:ro"), {
      guest: "/etc",
      bind: "./etc",
      readonly: true,
    });
  });

  it(":ro suffix sets readonly on named volume", () => {
    assert.deepEqual(parseVolumeSpec("cache:/cache:ro"), {
      guest: "/cache",
      volume: "cache",
      readonly: true,
    });
  });

  it("object is passed through unchanged", () => {
    const o = { guest: "/x", bind: "./y" } as const;
    assert.equal(parseVolumeSpec(o), o);
  });

  it("rejects relative guest paths", () => {
    assert.throws(() => parseVolumeSpec("./a:b"), /guest path must be absolute/);
  });

  it("rejects malformed strings", () => {
    assert.throws(() => parseVolumeSpec("no-colon"), /invalid volume spec/);
    assert.throws(() => parseVolumeSpec("a:b:c:d"), /invalid volume spec/);
  });
});
