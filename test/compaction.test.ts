import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { defaultConfig, normalizeConfig } from "../src/config.ts";
import { compact, excerpt, render, type Dependencies } from "../src/compaction/core.ts";
import { keptTail, llmViews, parseLlmDecisions } from "../src/compaction/extension.ts";

const cfg = { ...defaultConfig().compaction, enabled: true, minReduction: 0.01, minResultChars: 400, retainedChars: 100 };
const msgs = (result: string) => [
  { role: "user", content: [{ type: "text", text: "Implement feature X" }], timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "Inspecting" }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }], timestamp: 2 },
  { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: result }], isError: false, timestamp: 3 },
  { role: "user", content: [{ type: "text", text: "Keep going" }], timestamp: 4 },
] as unknown as AgentMessage[];
const messages = msgs("x".repeat(2000)); // fully visible to Jev
const partial = msgs(`${"h".repeat(3000)}MIDDLE${"t".repeat(3000)}`); // longer than Jev's excerpt
const response = (confidence: number, choice = "shorten") => ({ answers: { r1: { type: "choice" as const, choice, confidence, probabilities: { [choice]: confidence } } } });
const noLlm = async () => { throw new Error("LLM must not be called"); };

test("high-confidence Jev shortens a fully visible result without the LLM, keeping head and tail", async () => {
  const result = await compact({ messages, previousSummary: "earlier decisions" }, cfg, { askJev: async () => response(0.99), askLlm: noLlm });
  assert.ok(result.ok);
  assert.equal(result.stats.shortened, 1);
  assert.equal(result.stats.verify, 0);
  assert.match(result.summary, /earlier decisions/);
  assert.match(result.summary, /Implement feature X/);
  assert.match(result.summary, /read.*a.ts/);
  assert.match(result.summary, /omitted 1900 characters from the middle/);
});

test("Jev sees head and tail of a long result, marked incomplete", async () => {
  let seen: { complete: boolean; excerpt: string } | undefined;
  await compact({ messages: partial }, cfg, {
    askJev: async state => { seen = (state as { results: { complete: boolean; excerpt: string }[] }).results[0]; return response(0.99, "keep"); },
    askLlm: noLlm,
  });
  assert.equal(seen?.complete, false);
  assert.match(seen!.excerpt, /^h+/);
  assert.match(seen!.excerpt, /t+$/);
  assert.match(seen!.excerpt, /characters not shown/);
  assert.doesNotMatch(seen!.excerpt, /MIDDLE/);
});

test("confident shorten on a partial view requires LLM confirmation", async () => {
  let asked: string[] = [];
  const confirmed = await compact({ messages: partial }, cfg, { askJev: async () => response(0.99), askLlm: async (_s, c) => { asked = c.map(x => x.id); return { decisions: { r1: "shorten" } }; } });
  assert.ok(confirmed.ok);
  assert.deepEqual(asked, ["r1"]);
  assert.equal(confirmed.stats.verify, 1);
  assert.equal(confirmed.stats.shortened, 1);
  for (const askLlm of [async () => ({ decisions: { r1: "keep" as const } }), async () => { throw new Error("offline"); }]) {
    const rejected = await compact({ messages: partial }, cfg, { askJev: async () => response(0.99), askLlm });
    assert.equal(rejected.ok, false); // nothing shortened -> no reduction -> Pi compaction
  }
});

test("low confidence calls LLM and follows a valid verdict", async () => {
  let ids: string[] = [];
  const result = await compact({ messages }, cfg, { askJev: async () => response(0.51), askLlm: async (_s, c) => { ids = c.map(x => x.id); return { decisions: { r1: "shorten" } }; } });
  assert.ok(result.ok);
  assert.deepEqual(ids, ["r1"]);
  assert.equal(result.stats.uncertain, 1);
  assert.equal(result.stats.llmResolved, 1);
});

test("low confidence with LLM keep, missing output or failure never shortens", async () => {
  for (const askLlm of [async () => ({ decisions: { r1: "keep" as const } }), async () => ({ decisions: {} }), async () => { throw new Error("offline"); }]) {
    const result = await compact({ messages }, cfg, { askJev: async () => response(0.55), askLlm });
    assert.equal(result.ok, false);
  }
});

test("kept tail and current goal reach Jev", async () => {
  const recent = [{ role: "user", content: [{ type: "text", text: "Now fix the parser in a.ts" }], timestamp: 5 }] as unknown as AgentMessage[];
  let state: { recentContext: string; currentGoal: string } | undefined;
  await compact({ messages, recent }, cfg, { askJev: async s => { state = s as typeof state; return response(0.99, "keep"); }, askLlm: noLlm });
  assert.match(state!.recentContext, /fix the parser/);
  assert.match(state!.currentGoal, /fix the parser/);
});

test("reduction counts the previous summary; oversize summaries fall back to Pi", async () => {
  const deps: Dependencies = { askJev: async () => response(0.99), askLlm: noLlm };
  const small = { ...cfg, minReduction: 0.15 };
  const diluted = await compact({ messages, previousSummary: "P".repeat(50_000) }, small, deps);
  assert.equal(diluted.ok, false);
  assert.match((diluted as { reason: string }).reason, /below 15%/);
  const oversized = await compact({ messages, previousSummary: "P".repeat(70_000) }, cfg, deps);
  assert.equal(oversized.ok, false);
  assert.match((oversized as { reason: string }).reason, /previous summary is 70000 chars/);
  const longTalk = [{ role: "user", content: [{ type: "text", text: "q".repeat(5000) }], timestamp: 0 }, ...messages] as unknown as AgentMessage[];
  const budget = await compact({ messages: longTalk }, { ...cfg, maxSummaryChars: 4000, minReduction: 0 }, deps);
  assert.equal(budget.ok, false);
  assert.match((budget as { reason: string }).reason, /over the 4000-char budget/);
  const ok = await compact({ messages, previousSummary: "earlier" }, cfg, deps);
  assert.ok(ok.ok);
  assert.equal(ok.stats.charsAfter, ok.summary.length);
  assert.ok(ok.stats.charsBefore > ok.stats.charsAfter);
});

test("custom instructions and unsupported content fall back with a reason", async () => {
  const deps: Dependencies = { askJev: async () => response(0.99), askLlm: noLlm };
  const custom = await compact({ messages, instructions: "preserve errors" }, cfg, deps);
  assert.equal(custom.ok, false);
  assert.match((custom as { reason: string }).reason, /custom/);
  assert.equal(render([{ role: "user", content: [{ type: "image", data: "abc", mimeType: "image/png" }], timestamp: 1 }] as AgentMessage[], new Set(), 100), undefined);
});

test("error results and the boundary result are never candidates", async () => {
  const boundary = [...messages.slice(0, 2), { ...(messages[2] as object), isError: true }, messages[3], messages[2]] as AgentMessage[];
  let calls = 0;
  const result = await compact({ messages: boundary }, cfg, { askJev: async () => { calls++; return { answers: {} }; }, askLlm: noLlm });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test("excerpt and LLM views", () => {
  assert.deepEqual(excerpt("short", 10), { text: "short", complete: true });
  const view = excerpt("a".repeat(60) + "b".repeat(60), 100);
  assert.equal(view.complete, false);
  assert.match(view.text, /^a{60}/);
  assert.match(view.text, /b{40}$/);
  const views = llmViews([{ id: "r1", index: 0, tool: "read", text: "z".repeat(20_000), isError: false }]);
  assert.equal(views[0]?.complete, false);
  assert.ok(views[0]!.excerpt.length <= 8100);
});

test("keptTail is empty without branch entries and tolerates unknown ids", () => {
  assert.deepEqual(keptTail(undefined, "x"), []);
  assert.deepEqual(keptTail([], "x"), []);
});

test("LLM JSON parser rejects invalid and ignores unexpected choices", () => {
  const c = [{ id: "r1", index: 0, tool: "read", text: "a", isError: false }];
  assert.deepEqual(parseLlmDecisions('```json\n{"r1":"shorten","r2":"shorten"}\n```', c), { r1: "shorten" });
  assert.deepEqual(parseLlmDecisions('{"r1":"delete"}', c), {});
  assert.throws(() => parseLlmDecisions("oops", c));
});

test("configuration opt-in and bounds", () => {
  assert.equal(defaultConfig().compaction.enabled, false);
  assert.equal(defaultConfig().compaction.maxSummaryChars, 60000);
  const c = normalizeConfig({ compaction: { enabled: true, model: "openrouter/x", minConfidence: 0.1, retainedChars: 0, maxSummaryChars: 10 } }).config.compaction;
  assert.equal(c.enabled, true);
  assert.equal(c.model, "openrouter/x");
  assert.equal(c.minConfidence, 0.5);
  assert.equal(c.retainedChars, 100);
  assert.equal(c.maxSummaryChars, 4000);
});
