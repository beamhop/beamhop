import { describe, it } from "./_shim.js";
import assert from "./_shim.js";
import { parseDockerfile, DockerfileParseError } from "../src/dockerfile-parser.js";

describe("parseDockerfile", () => {
  it("parses a minimal Dockerfile", () => {
    const steps = parseDockerfile("FROM alpine:3.19");
    assert.deepEqual(steps, [{ kind: "FROM", image: "alpine:3.19" }]);
  });

  it("requires FROM as the first directive", () => {
    assert.throws(() => parseDockerfile("RUN echo hi"), DockerfileParseError);
  });

  it("ignores blank lines and # comments", () => {
    const src = `
      # this is a comment
      FROM alpine

      # another
      RUN echo hello
    `;
    const steps = parseDockerfile(src);
    assert.equal(steps.length, 2);
    assert.equal(steps[0]!.kind, "FROM");
    assert.equal(steps[1]!.kind, "RUN");
  });

  it("joins backslash line continuations", () => {
    const src = `FROM alpine
RUN apk add --no-cache \\
    curl \\
    jq`;
    const steps = parseDockerfile(src);
    assert.equal(steps.length, 2);
    assert.equal(steps[1]!.kind, "RUN");
    assert.match((steps[1] as { command: string }).command, /curl.+jq/);
  });

  it("parses ENV with = and with space", () => {
    const steps = parseDockerfile(`FROM alpine
ENV FOO=bar
ENV BAZ qux`);
    assert.deepEqual(steps[1], { kind: "ENV", key: "FOO", value: "bar" });
    assert.deepEqual(steps[2], { kind: "ENV", key: "BAZ", value: "qux" });
  });

  it("strips quotes from ENV values", () => {
    const steps = parseDockerfile(`FROM alpine
ENV MSG="hello world"`);
    assert.deepEqual(steps[1], { kind: "ENV", key: "MSG", value: "hello world" });
  });

  it("parses COPY src dst", () => {
    const steps = parseDockerfile(`FROM alpine
COPY ./app /app`);
    assert.deepEqual(steps[1], { kind: "COPY", src: "./app", dst: "/app" });
  });

  it("parses ADD src dst", () => {
    const steps = parseDockerfile(`FROM alpine
ADD foo.tar /tmp`);
    assert.deepEqual(steps[1], { kind: "ADD", src: "foo.tar", dst: "/tmp" });
  });

  it("parses RUN exec form into a shell-equivalent string", () => {
    const steps = parseDockerfile(`FROM alpine
RUN ["echo", "hello world"]`);
    assert.equal(steps[1]!.kind, "RUN");
    assert.equal((steps[1] as { command: string }).command, "echo 'hello world'");
  });

  it("parses CMD/ENTRYPOINT exec form as argv", () => {
    const steps = parseDockerfile(`FROM alpine
ENTRYPOINT ["node", "server.js"]
CMD ["--port", "8080"]`);
    assert.deepEqual(steps[1], { kind: "ENTRYPOINT", argv: ["node", "server.js"] });
    assert.deepEqual(steps[2], { kind: "CMD", argv: ["--port", "8080"] });
  });

  it("wraps shell-form CMD/ENTRYPOINT in /bin/sh -c", () => {
    const steps = parseDockerfile(`FROM alpine
CMD echo hi`);
    assert.deepEqual(steps[1], { kind: "CMD", argv: ["/bin/sh", "-c", "echo hi"] });
  });

  it("parses WORKDIR and USER", () => {
    const steps = parseDockerfile(`FROM alpine
WORKDIR /app
USER node`);
    assert.deepEqual(steps[1], { kind: "WORKDIR", path: "/app" });
    assert.deepEqual(steps[2], { kind: "USER", user: "node" });
  });

  it("rejects unsupported directives with a clear error", () => {
    try {
      parseDockerfile(`FROM alpine
ARG MY_BUILD_ARG=1`);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof DockerfileParseError);
      assert.match(err.message, /ARG/);
      assert.match(err.message, /not supported/);
    }
  });

  it("rejects unknown directives", () => {
    try {
      parseDockerfile(`FROM alpine
ZIGGURAT something`);
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof DockerfileParseError);
      assert.match(err.message, /unknown directive/);
    }
  });

  it("preserves ordering across mixed directives", () => {
    const steps = parseDockerfile(`FROM alpine
ENV A=1
WORKDIR /app
RUN echo step1
COPY ./x /x
RUN echo step2
CMD ["sh"]`);
    assert.deepEqual(
      steps.map((s) => s.kind),
      ["FROM", "ENV", "WORKDIR", "RUN", "COPY", "RUN", "CMD"],
    );
  });
});
