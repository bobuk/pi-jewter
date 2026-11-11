import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { defaultConfig, normalizeConfig } from "../src/config.ts";
import { buildJevQuestions, buildJevState } from "../src/jev/decide.ts";
import { createRoute, stepContext } from "../src/router/virtual.ts";
import type { RouterState, RoutingRecord } from "../src/router/state.ts";

const fast = { provider: "test", id: "fast", api: "openai-completions", reasoning: true };
const strong = { ...fast, id: "strong" };
const ctx = { modelRegistry: { getAvailable: () => [fast, strong] } } as unknown as ExtensionContext;
const messages = [
  { role: "user", content: "Implement the plan" },
  { role: "assistant", content: [
    { type: "thinking", thinking: "PRIVATE_THINKING" },
    { type: "text", text: "Now check the tests" },
    { type: "toolCall", name: "bash", arguments: { command: "npm test" } },
  ] },
  { role: "toolResult", toolName: "bash", isError: true, content: [
    { type: "text", text: "FAIL regression" }, { type: "image", data: "PRIVATE_IMAGE" },
  ] },
] as unknown as Message[];

function harness(confidence = 0.9) {
  const config = defaultConfig();
  config.tiers.medium.model = "test/fast";
  config.tiers.strong.model = "test/strong";
  const records: RoutingRecord[] = [];
  const calls: unknown[][] = [];
  const route = createRoute({
    getContext: () => ctx, getConfig: () => config, observe: r => records.push(r),
    classify: async (...args) => {
      calls.push(args);
      return { transport: "fake", response: { answers: {
        role: { choice: "verification", confidence, probabilities: { verification: confidence } }, complexity: { score: 0.9, confidence },
      } } };
    },
  });
  const request = (reason = "continuation", extra = {}) => ({
    reason, model: { provider: "jewter", id: "auto" }, thinkingLevel: "low", messages,
    previous: { model: fast, thinkingLevel: "low" }, state: { role: "implementation", tier: "medium" },
    ...extra,
  }) as unknown as ModelRouteRequest<RouterState>;
  return { config, records, calls, route, request };
}

test("step routing and cache penalty are defaults, normalized and inherited", () => {
  assert.equal(defaultConfig().routing.mode, "step");
  assert.equal(defaultConfig().routing.cachePenalty, 0.15);
  const base = normalizeConfig({ routing: { mode: "request", cachePenalty: 0.3 } }).config;
  assert.equal(normalizeConfig({ routing: { mode: "bad", cachePenalty: NaN } }, base).config.routing.mode, "request");
  assert.equal(normalizeConfig({ routing: { cachePenalty: -1 } }).config.routing.cachePenalty, 0);
  assert.equal(normalizeConfig({ routing: { cachePenalty: 2 } }).config.routing.cachePenalty, 1);
  assert.equal(normalizeConfig({ routing: { mode: "step" } }, base).config.routing.cachePenalty, 0.3);
});

test("continuations reclassify with tool evidence and switch when confident", async () => {
  const h = harness();
  const selected = await h.route(h.request());
  assert.equal(selected.model.id, "strong");
  assert.equal(selected.state?.role, "verification");
  assert.equal(h.calls[0]?.[1], "Implement the plan");
  assert.match(String(h.calls[0]?.[5]), /npm test/);
  assert.match(String(h.calls[0]?.[5]), /FAIL regression/);
  assert.equal(h.records[0]?.status, "switch");
});

test("cache penalty keeps physical model and state on marginal switches; zero disables it", async () => {
  const h = harness(0.7);
  const selected = await h.route(h.request());
  assert.equal(selected.model.id, "fast");
  assert.equal(selected.thinkingLevel, "low");
  assert.equal(selected.state?.role, "implementation");
  assert.equal(h.records[0]?.classifiedRole, "verification");
  assert.match(h.records[0]?.reason ?? "", /cache-penalty/);
  h.config.routing.cachePenalty = 0;
  assert.equal((await h.route(h.request())).model.id, "strong");
});

test("cache penalty does not block a new user request or same-model thinking changes", async () => {
  const h = harness(0.7);
  assert.equal((await h.route(h.request("user"))).model.id, "strong");
  assert.equal(h.calls[0]?.[5], undefined);
  h.config.tiers.strong.model = "test/fast";
  const selected = await h.route(h.request());
  assert.equal(selected.model.id, "fast");
  assert.equal(selected.thinkingLevel, "high");
  assert.equal(selected.state?.role, "verification");
});

test("request mode, retries and direct calls skip classification and use appropriate fallback", async () => {
  const h = harness();
  h.config.routing.mode = "request";
  assert.equal((await h.route(h.request())).model.id, "fast");
  h.config.routing.mode = "step";
  assert.equal((await h.route(h.request("retry", { failed: { model: strong, thinkingLevel: "high" } }))).model.id, "strong");
  assert.equal((await h.route(h.request("direct"))).model.id, "fast");
  assert.equal(h.calls.length, 0);
});

test("disabled routing skips classifier even in step mode", async () => {
  const h = harness();
  h.config.enabled = false;
  assert.equal((await h.route(h.request())).model.id, "fast");
  assert.equal(h.calls.length, 0);
});

test("step evidence is bounded, excludes thinking/images, and stays within latest user turn", () => {
  const excerpt = stepContext(messages);
  assert.match(excerpt, /Tool result bash \(error\)/);
  assert.doesNotMatch(excerpt, /PRIVATE/);
  assert.equal(stepContext([...messages, { role: "user", content: "New task" } as Message]), "");
  const huge = [...messages, ...Array.from({ length: 20 }, () => ({
    role: "toolResult", toolName: "read", content: [{ type: "text", text: "start" + "x".repeat(10000) + "end" }],
  }))] as Message[];
  const bounded = stepContext(huge);
  assert.ok(bounded.length <= 8000);
  assert.match(bounded, /start/);
  assert.match(bounded, /end/);
  assert.doesNotMatch(bounded, /npm test/);
  assert.equal(String(buildJevState("goal", "planning", undefined, "x".repeat(10000)).step_context).length, 8000);
  assert.match(JSON.stringify(buildJevQuestions(defaultConfig())), /NEXT response/);
});

test("step classification failures retain prior model; cancellation propagates", async () => {
  const config = defaultConfig();
  const h = harness();
  const route = createRoute({ getContext: () => ctx, getConfig: () => config, observe: () => {}, classify: async () => { throw new Error("offline"); } });
  assert.equal((await route(h.request())).model.id, "fast");
  await assert.rejects(route(h.request("continuation", { signal: AbortSignal.abort() })), /offline/);
});
