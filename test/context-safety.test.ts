import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { ContextError, CONTEXT_ENTRY, fitViews, isContextError, JEV_REQUEST_BYTES } from "../src/service/context.ts";
import { JevClient, resolveTransport } from "../src/jev/client.ts";
import { defaultConfig } from "../src/config.ts";
import { createRoute } from "../src/router/virtual.ts";
import type { RouterState } from "../src/router/state.ts";
import { registerVerify } from "../src/verify/extension.ts";
import { contextRecorder } from "../src/service/context.ts";
import { registerCompaction } from "../src/compaction/extension.ts";

const questions = { role: { type: "choice" as const, instructions: "pick", criteria: { exact_id: "criteria" } } };
function client(fetcher: typeof fetch, events: string[] = []) {
  const resolved = resolveTransport(defaultConfig().jev, { TYPESAFE_API_KEY: "secret" });
  assert.ok(resolved.ok);
  return new JevClient({ transport: resolved.transport, timeoutMs: 1000, fetch: fetcher, diagnostic: (service, event) => events.push(`${service}:${event}`) });
}

test("Jev fits combined Unicode evidence and questions without changing originals", async () => {
  const state = { prompt: '😀漢字\u0000"'.repeat(20_000), previous_exchange: "x".repeat(20_000), current_role: "exact_id" };
  const original = structuredClone(state);
  const events: string[] = [];
  let calls = 0;
  await client(async (_url, init) => {
    calls++;
    const body = String(init?.body);
    assert.ok(Buffer.byteLength(body) <= JEV_REQUEST_BYTES);
    const sent = JSON.parse(body);
    assert.deepEqual(sent.questions, questions);
    assert.equal(sent.state.current_role, "exact_id");
    assert.match(sent.state.prompt, /view omitted/);
    return new Response('{"answers":{}}');
  }, events).ask(state, questions);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["jev:reduced"]);
  assert.deepEqual(state, original);
});

test("fixed questions and IDs cannot be truncated to fit", async () => {
  let calls = 0;
  const events: string[] = [];
  await assert.rejects(client(async () => { calls++; return new Response('{}'); }, events).ask({ prompt: "small" }, {
    role: { ...questions.role, instructions: "x".repeat(JEV_REQUEST_BYTES) },
  }), ContextError);
  assert.equal(calls, 0);
  assert.deepEqual(events, ["jev:fixed-overhead"]);
  assert.throws(() => fitViews({ id: "x".repeat(100) }, JSON.stringify, 30), ContextError);
});

test("Jev recognizes long HTTP and thrown context errors without retaining provider text", async () => {
  for (const status of [400, 413, 422]) {
    const events: string[] = [];
    await assert.rejects(client(async () => new Response("private ".repeat(1000) + "maximum context length exceeded", { status }), events).ask({}, questions), error => error instanceof ContextError && !error.message.includes("private"));
    assert.deepEqual(events, ["jev:provider-overflow"]);
  }
  await assert.rejects(client(async () => { throw new Error("context_length_exceeded"); }).ask({}, questions), ContextError);
  assert.ok(isContextError({ error: { message: "prompt is too long" } }));
});

for (const mode of ["success", "thrown", "returned", "tiny", "thinking", "thinking-tiny"] as const) {
  test(`compaction persists context failures and uses safe fallback: ${mode}`, async () => {
    let handler: Function | undefined;
    const entries: { type: string; data: unknown }[] = [];
    const pi = { on: (_event: string, fn: Function) => { handler = fn; }, appendEntry: (type: string, data: unknown) => entries.push({ type, data }) } as unknown as ExtensionAPI;
    const config = defaultConfig();
    Object.assign(config.compaction, { enabled: true, minResultChars: 400, retainedChars: 100, minReduction: 0.01 });
    config.tiers.fast.model = "openrouter/fast";
    const thinking = mode === "thinking" || mode === "thinking-tiny";
    if (thinking) config.compaction.thinking = "high";
    const window = mode === "tiny" ? 1000 : mode === "thinking-tiny" ? 16000 : thinking ? 24000 : 8192;
    registerCompaction(pi, () => config);
    const originalFetch = globalThis.fetch;
    const oldKey = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "secret";
    let jevCalls = 0;
    globalThis.fetch = async () => { jevCalls++; return new Response("private ".repeat(1000) + "context length exceeded", { status: 400 }); };
    let llmCalls = 0;
    const notices: string[] = [];
    const ctx = { hasUI: false, ui: { notify: (text: string) => notices.push(text) }, modelRegistry: {
      getAvailable: () => [{ provider: "openrouter", id: "fast", api: thinking ? "anthropic-messages" : "openai-completions", reasoning: thinking, contextWindow: window, maxTokens: thinking ? 16384 : 2048 }],
      streamSimple: (_model: unknown, context: unknown, options: { maxTokens: number; reasoning?: string }) => {
        llmCalls++;
        assert.ok(Buffer.byteLength(JSON.stringify(context)) + (thinking ? 16384 : options.maxTokens) + 1024 <= window);
        if (thinking) assert.equal(options.reasoning, "high");
        if (mode === "thrown") throw new Error("private ".repeat(1000) + "maximum context length exceeded");
        return { result: async () => mode === "returned" ? { stopReason: "error", errorMessage: "private ".repeat(1000) + "context_length_exceeded" } : { stopReason: "stop", content: [{ type: "text", text: '{"r1":"shorten"}' }] } };
      },
    } } as unknown as ExtensionContext;
    const event = { signal: new AbortController().signal, preparation: { messagesToSummarize: [
      { role: "user", content: [{ type: "text", text: "Keep this original goal" }] },
      { role: "toolResult", toolCallId: "original-id", toolName: "read", content: [{ type: "text", text: "😀漢字".repeat(6000) }], isError: false },
      { role: "user", content: [{ type: "text", text: "Continue" }] },
    ], turnPrefixMessages: [], firstKeptEntryId: "boundary", tokensBefore: 12000 } };
    const original = structuredClone(event.preparation);
    try {
      const result = await handler!(event, ctx);
      assert.equal(jevCalls, 1);
      assert.equal(llmCalls, mode === "tiny" || mode === "thinking-tiny" ? 0 : 1);
      assert.ok(entries.some(e => e.type === CONTEXT_ENTRY && JSON.stringify(e.data).includes('"service":"jev"') && JSON.stringify(e.data).includes("provider-overflow")));
      if (mode === "success" || mode === "thinking") {
        assert.ok(result.compaction.summary.includes("Keep this original goal"));
        assert.ok(result.compaction.summary.includes("original-id"));
      } else {
        assert.equal(result, undefined); // Pi compaction owns the fallback.
        assert.ok(entries.some(e => JSON.stringify(e.data).includes('"service":"llm"')));
      }
      assert.ok(!JSON.stringify(entries).includes("private"));
      assert.ok(!JSON.stringify(entries).includes("secret"));
      assert.ok(!JSON.stringify(entries).includes("original goal"));
      assert.ok(!notices.join().includes("private"));
      assert.deepEqual(event.preparation, original);
    } finally {
      globalThis.fetch = originalFetch;
      if (oldKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = oldKey;
    }
  });
}

test("already cancelled requests do not call Jev or persist a context failure", async () => {
  const controller = new AbortController();
  controller.abort();
  const events: string[] = [];
  let called = false;
  await assert.rejects(client(async () => { called = true; return new Response('{}'); }, events).ask({}, questions, controller.signal));
  assert.equal(called, false);
  assert.deepEqual(events, []);
});

test("Jev returned context errors are recognized, normal answers are not error text", async () => {
  await assert.rejects(client(async () => new Response(JSON.stringify({ error: { code: "context_length_exceeded", message: "private" } }))).ask({}, questions), ContextError);
  const result = await client(async () => new Response(JSON.stringify({ answers: { role: { choice: "context_window", confidence: 1 } } }))).ask({}, questions);
  assert.equal((result.answers.role as { choice: string }).choice, "context_window");
  const cyclic: Record<string, unknown> = { code: "context_length_exceeded" };
  cyclic.cause = cyclic;
  assert.ok(isContextError(cyclic));
});


test("routing refuses oversized criteria, preserves the previous route, and persists metadata", async () => {
  const config = defaultConfig();
  config.roles.planning!.description = "private".repeat(JEV_REQUEST_BYTES);
  config.jev.typesafeApiKey = "secret";
  const model = { provider: "openrouter", id: "fast", api: "openai-completions", reasoning: false };
  const entries: unknown[] = [];
  const pi = { appendEntry: (_type: string, data: unknown) => entries.push(data) } as unknown as ExtensionAPI;
  const ctx = { modelRegistry: { getAvailable: () => [model] } } as unknown as ExtensionContext;
  const route = createRoute({ getContext: () => ctx, getConfig: () => config, observe: () => {}, diagnostic: contextRecorder(pi, "routing") });
  const request = { reason: "user", messages: [{ role: "user", content: "plan" }], previous: { model }, thinkingLevel: "off" } as unknown as ModelRouteRequest<RouterState>;
  const result = await route(request);
  assert.equal(result.model, model);
  assert.deepEqual(entries, [{ version: 1, service: "jev", purpose: "routing", event: "fixed-overhead" }]);
  assert.ok(!JSON.stringify(result.state).includes("private"));
});

test("verification fixed overhead refusal remains silent and keeps the editor", async () => {
  const handlers = new Map<string, Function>();
  const entries: unknown[] = [];
  const config = defaultConfig();
  config.jev.typesafeApiKey = "secret";
  let editor = "draft";
  const pi = { on: (name: string, fn: Function) => handlers.set(name, fn), registerEntryRenderer: () => {}, appendEntry: (_type: string, data: unknown) => entries.push(data) } as unknown as ExtensionAPI;
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => "/s/main.jsonl" }, ui: { getEditorText: () => editor, setEditorText: (text: string) => { editor = text; } } } as unknown as ExtensionContext;
  const verify = registerVerify(pi, () => config);
  const emit = async (name: string, event: unknown) => handlers.get(name)!(event, ctx);
  await emit("before_agent_start", { messageType: "user", prompt: "fix" });
  await emit("tool_call", { toolCallId: "id", toolName: "edit", input: { path: "private".repeat(JEV_REQUEST_BYTES) } });
  await emit("tool_result", { toolCallId: "id", toolName: "edit", isError: false });
  await emit("agent_settled", { aborted: false });
  await verify.idle();
  assert.equal(editor, "draft");
  assert.deepEqual(entries, [{ version: 1, service: "jev", purpose: "verification", event: "fixed-overhead" }]);
});


test("Jev sanitizes context failures thrown while reading response bodies", async () => {
  const events: string[] = [];
  const response = new Response("", { status: 200 });
  Object.defineProperty(response, "text", { value: async () => { throw new Error("private ".repeat(1000) + "context_length_exceeded"); } });
  await assert.rejects(client(async () => response, events).ask({}, questions), error => error instanceof ContextError && !error.message.includes("private"));
  assert.deepEqual(events, ["jev:provider-overflow"]);
});

for (const body of ["thrown", "http", "json", "success"] as const) {
  test(`Jev late cancellation wins over body ${body} without context diagnostics`, async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const response = new Response("", { status: body === "http" ? 413 : 200 });
    Object.defineProperty(response, "text", { value: async () => {
      controller.abort();
      if (body === "thrown") throw new Error("private context_length_exceeded");
      if (body === "http") return "private context length exceeded";
      if (body === "json") return '{"error":{"message":"private context length exceeded"}}';
      return '{"answers":{}}';
    } });
    await assert.rejects(client(async () => response, events).ask({}, questions, controller.signal), error => error === controller.signal.reason);
    assert.deepEqual(events, []);
  });
}

test("Jev body network errors are sanitized without a false context diagnostic", async () => {
  const events: string[] = [];
  const response = new Response("");
  Object.defineProperty(response, "text", { value: async () => { throw new Error("private body failure"); } });
  await assert.rejects(client(async () => response, events).ask({}, questions), error => error instanceof Error && /network or timeout/.test(error.message) && !error.message.includes("private"));
  assert.deepEqual(events, []);
});
