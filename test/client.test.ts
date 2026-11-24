import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, normalizeConfig } from "../src/config.ts";
import { JevClient, JevError, resolveTransport } from "../src/jev/client.ts";

function jevConfig(overrides: Partial<Parameters<typeof resolveTransport>[0]> = {}) {
  return { ...defaultConfig().jev, ...overrides };
}

test("resolveTransport: auto prefers TypeSafe when both keys exist", () => {
  const result = resolveTransport(jevConfig(), { TYPESAFE_API_KEY: "ts", OPENROUTER_API_KEY: "or" });
  assert.ok(result.ok);
  assert.equal(result.transport.id, "typesafe");
  assert.equal(result.transport.apiKey, "ts");
  assert.equal(result.transport.model, "jev-latest");
});

test("resolveTransport: saved TypeSafe key is normalized and preferred over OpenRouter in auto", () => {
  const { config } = normalizeConfig({ jev: { typesafeApiKey: "  saved-key  " } });
  assert.equal(config.jev.typesafeApiKey, "saved-key");
  const result = resolveTransport(config.jev, { OPENROUTER_API_KEY: "or" });
  assert.ok(result.ok);
  assert.equal(result.transport.id, "typesafe");
  assert.equal(result.transport.apiKey, "saved-key");
});

test("resolveTransport: environment credentials override the saved TypeSafe key", () => {
  for (const [env, expected] of [
    [{ TYPESAFE_API_KEY: " ts " }, "ts"],
    [{ TYPESAFE_API_KEY: "ts", JEWTER_API_KEY: " override " }, "override"],
    [{ TYPESAFE_API_KEY: "   " }, "saved"],
  ] as const) {
    const result = resolveTransport(jevConfig({ transport: "typesafe", typesafeApiKey: " saved " }), env);
    assert.ok(result.ok);
    assert.equal(result.transport.apiKey, expected);
  }
});

test("resolveTransport: saved TypeSafe key is never used for explicit OpenRouter", () => {
  const config = jevConfig({ transport: "openrouter", typesafeApiKey: "saved" });
  assert.equal(resolveTransport(config, {}).ok, false);
  const result = resolveTransport(config, { OPENROUTER_API_KEY: "or" });
  assert.ok(result.ok);
  assert.equal(result.transport.id, "openrouter");
  assert.equal(result.transport.apiKey, "or");
});

test("resolveTransport: blank or invalid saved keys are ignored", () => {
  for (const typesafeApiKey of ["   ", 123, null]) {
    const { config } = normalizeConfig({ jev: { typesafeApiKey } });
    assert.equal(config.jev.typesafeApiKey, undefined);
    assert.equal(resolveTransport(config.jev, {}).ok, false);
  }
});

test("resolveTransport: auto falls back to OpenRouter", () => {
  const result = resolveTransport(jevConfig(), { OPENROUTER_API_KEY: "or" });
  assert.ok(result.ok);
  assert.equal(result.transport.id, "openrouter");
  assert.equal(result.transport.baseUrl, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(result.transport.model, "typesafe/jev-1.13");
});

test("resolveTransport: auto without credentials fails", () => {
  const result = resolveTransport(jevConfig(), {});
  assert.equal(result.ok, false);
});

test("resolveTransport: explicit transport requires its key", () => {
  const result = resolveTransport(jevConfig({ transport: "typesafe" }), { OPENROUTER_API_KEY: "or" });
  assert.equal(result.ok, false);
});

test("resolveTransport: JEWTER_API_KEY overrides the transport key", () => {
  const result = resolveTransport(jevConfig({ transport: "openrouter" }), { JEWTER_API_KEY: "override" });
  assert.ok(result.ok);
  assert.equal(result.transport.apiKey, "override");
});

test("resolveTransport: model and baseUrl overrides apply", () => {
  const result = resolveTransport(
    jevConfig({ transport: "typesafe", model: "jev-1.14.0", baseUrl: "https://proxy.example/v1" }),
    { TYPESAFE_API_KEY: "ts" },
  );
  assert.ok(result.ok);
  assert.equal(result.transport.model, "jev-1.14.0");
  assert.equal(result.transport.baseUrl, "https://proxy.example/v1");
});

test("JevClient sends the System One request shape and parses answers", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchStub: typeof fetch = async (input, init) => {
    seen = { url: String(input), init: init as RequestInit };
    return new Response(JSON.stringify({ answers: { role: { choice: "planning", confidence: 0.9 } } }), {
      status: 200,
    });
  };
  const resolved = resolveTransport(jevConfig({ transport: "typesafe" }), { TYPESAFE_API_KEY: "ts" });
  assert.ok(resolved.ok);
  const client = new JevClient({ transport: resolved.transport, timeoutMs: 1000, fetch: fetchStub });
  const result = await client.ask({ prompt: "hello" }, {
    role: { type: "choice", instructions: "pick", criteria: { planning: "plan things" } },
  });
  const role = result.answers.role;
  assert.ok(role && "choice" in role);
  assert.equal(role.choice, "planning");
  assert.equal(seen?.url, "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(String(seen?.init.body));
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(body.state, { prompt: "hello" });
  assert.deepEqual(body.questions.role.criteria, { planning: "plan things" });
});

test("JevClient reports HTTP errors as JevError with status", async () => {
  const fetchStub: typeof fetch = async () =>
    new Response("rate limited", { status: 429 });
  const resolved = resolveTransport(jevConfig({ transport: "typesafe" }), { TYPESAFE_API_KEY: "ts" });
  assert.ok(resolved.ok);
  const client = new JevClient({ transport: resolved.transport, timeoutMs: 1000, fetch: fetchStub });
  await assert.rejects(
    () => client.ask({}, { role: { type: "choice", instructions: "pick", criteria: {} } }),
    (error: unknown) => error instanceof JevError && error.status === 429,
  );
});

test("JevClient rejects malformed responses", async () => {
  const fetchStub: typeof fetch = async () => new Response("{}", { status: 200 });
  const resolved = resolveTransport(jevConfig({ transport: "openrouter" }), { OPENROUTER_API_KEY: "or" });
  assert.ok(resolved.ok);
  const client = new JevClient({ transport: resolved.transport, timeoutMs: 1000, fetch: fetchStub });
  await assert.rejects(
    () => client.ask({}, { role: { type: "choice", instructions: "pick", criteria: {} } }),
    (error: unknown) => error instanceof JevError && /missing answers/.test(error.message),
  );
});

test("JevClient surfaces fetch failures", async () => {
  const fetchStub: typeof fetch = async () => {
    throw new Error("network down");
  };
  const resolved = resolveTransport(jevConfig({ transport: "openrouter" }), { OPENROUTER_API_KEY: "or" });
  assert.ok(resolved.ok);
  const client = new JevClient({ transport: resolved.transport, timeoutMs: 1000, fetch: fetchStub });
  await assert.rejects(
    () => client.ask({}, { role: { type: "choice", instructions: "pick", criteria: {} } }),
    (error: unknown) => error instanceof JevError && /network or timeout error/.test(error.message),
  );
});

test("JevClient enforces configurable maxResponseBytes on Content-Length and streamed chunks", async () => {
  const resolved = resolveTransport(jevConfig({ transport: "typesafe" }), { TYPESAFE_API_KEY: "ts" });
  assert.ok(resolved.ok);
  const q = { role: { type: "choice" as const, instructions: "pick", criteria: {} } };

  // Declared Content-Length above limit is rejected without reading further.
  const headerClient = new JevClient({
    transport: resolved.transport,
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    fetch: async () => new Response('{"answers":{}}', { status: 200, headers: { "content-length": "4096" } }),
  });
  await assert.rejects(
    () => headerClient.ask({}, q),
    (error: unknown) => error instanceof JevError && /exceeded 1024 bytes/.test(error.message),
  );

  // Streaming body without Content-Length cancels as soon as accumulated bytes exceed maxResponseBytes.
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(600).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamClient = new JevClient({
    transport: resolved.transport,
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    fetch: async () => new Response(stream, { status: 200 }),
  });
  await assert.rejects(
    () => streamClient.ask({}, q),
    (error: unknown) => error instanceof JevError && /exceeded 1024 bytes/.test(error.message),
  );
  assert.equal(cancelled, true);
  assert.ok(pulls <= 3);

  // Within limit succeeds cleanly.
  const okClient = new JevClient({
    transport: resolved.transport,
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    fetch: async () => new Response(JSON.stringify({ answers: { role: { choice: "planning", confidence: 0.9 } } }), { status: 200 }),
  });
  const ok = await okClient.ask({}, q);
  assert.ok("answers" in ok);
});
