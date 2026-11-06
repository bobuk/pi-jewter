import test from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig, normalizeConfig } from "../src/config.ts";
import { RequestReport, reportLines } from "../src/report/summary.ts";
import { registerReport, REPORT_ENTRY } from "../src/report/extension.ts";
import type { RoutingRecord } from "../src/router/state.ts";

function assistant(model = "sol", options: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant", provider: "openrouter", model, api: "openai-completions", thinkingLevel: "high", timestamp: 1,
    content: [{ type: "text", text: "Done" }], stopReason: "stop",
    usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    ...options,
  };
}
function route(): RoutingRecord {
  return {
    at: "", status: "switch", elapsedMs: 1, role: "implementation", tier: "medium", model: "openrouter/sol",
    transport: "openrouter", classifierModel: "typesafe/jev-1.13",
    decision: { action: "switch", role: "implementation", tier: "medium", roleConfidence: 1, score: 0.5, scoreConfidence: 0.8, tierSource: "jev", probabilities: { implementation: 1 } },
  };
}

test("receipt uses actual assistant model, not virtual or suggested model", () => {
  const r = new RequestReport(); r.start(100); r.route(route());
  r.assistant(assistant("different"));
  const report = r.finish(false, 200)!;
  assert.equal(report.models[0]?.model, "openrouter/different");
  assert.deepEqual(report.models[0]?.roles, []); // Don't attach a role to a model the route didn't name.
  assert.equal(report.services[0]?.model, "typesafe/jev-1.13");
  assert.equal(report.services[0]?.purpose, "routing");
  assert.equal(report.elapsedMs, 100);
  assert.equal(r.finish(false), undefined);
});

test("tools are attributed to the assistant that requested them, even after another model responds", () => {
  const r = new RequestReport(); r.start(); r.route(route());
  r.assistant(assistant("sol", { stopReason: "toolUse", content: [
    { type: "toolCall", id: "read-1", name: "read", arguments: { path: "private-path" } },
    { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
  ] }));
  r.assistant(assistant("flash"));
  r.toolEnd({ toolCallId: "read-1", toolName: "read", isError: false, durationMs: 0 });
  r.toolEnd({ toolCallId: "edit-1", toolName: "edit", isError: true }); // Blocked, never executed.
  r.toolEnd({ toolCallId: "unknown", toolName: "bash", isError: false, durationMs: 1 });
  const report = r.finish(false)!;
  assert.deepEqual(report.models[0]?.tools, { read: 1 });
  assert.equal(report.models[0]?.skippedTools, 1);
  assert.deepEqual(report.models[1]?.tools, {});
  const text = reportLines(report).join("\n");
  assert.match(text, /read ×1/); assert.doesNotMatch(text, /edit ×1|private-path/);
});

test("nested tool ownership is traced without guessing the last model", () => {
  const r = new RequestReport(); r.start();
  r.assistant(assistant("sol", { content: [{ type: "toolCall", id: "root", name: "codemode", arguments: {} }], stopReason: "toolUse" }));
  r.toolStart({ toolCallId: "nested", parentToolCallId: "root" });
  r.toolStart({ toolCallId: "deep", parentToolCallId: "nested" });
  r.toolEnd({ toolCallId: "deep", parentToolCallId: "nested", toolName: "read", isError: false, durationMs: 1 });
  r.toolEnd({ toolCallId: "root", toolName: "codemode", isError: false, durationMs: 5 });
  assert.deepEqual(r.finish(false)!.models[0]?.tools, { read: 1, codemode: 1 });
});

test("retries stay in one report and failed partial answers aren't reported as complete text", () => {
  const r = new RequestReport(); r.start(10);
  r.assistant(assistant("sol", { stopReason: "error", content: [{ type: "text", text: "Partial" }] }));
  r.start(20); // A retry/new agent_start must not clear the first attempt.
  r.assistant(assistant("sol"));
  const report = r.finish(false, 40)!;
  assert.equal(report.elapsedMs, 30); assert.equal(report.models.length, 1);
  assert.equal(report.models[0]?.responses, 2); assert.equal(report.models[0]?.failures, 1);
  assert.equal(report.models[0]?.textResponses, 1);
});

test("aborted runs are identified and state never leaks to the next request", () => {
  const r = new RequestReport(); r.start(); r.assistant(assistant("sol", { stopReason: "aborted" }));
  const first = r.finish(true)!;
  assert.match(reportLines(first).join("\n"), /interrupted/);
  assert.equal(first.models[0]?.aborted, 1);
  r.start(); r.assistant(assistant("flash"));
  assert.deepEqual(r.finish(false)!.models.map(m => m.model), ["openrouter/flash"]);
});

test("token-limited answers are visible but never reported as complete text", () => {
  const r = new RequestReport(); r.start();
  r.assistant(assistant("sol", { stopReason: "length" }));
  const report = r.finish(false)!;
  assert.equal(report.models[0]?.incomplete, 1);
  assert.equal(report.models[0]?.textResponses, 0);
  assert.match(reportLines(report).join("\n"), /token-limited answers: 1/);
});

test("compaction and classifier are separate services, not extra assistant responses", () => {
  const r = new RequestReport(); r.start(); r.route(route());
  r.service({ kind: "classifier", purpose: "compaction", model: "typesafe/jev-1.13", transport: "openrouter" });
  r.service({ kind: "compaction", model: "openai-codex/luna", thinking: "low" });
  r.service({ kind: "compaction", model: "openai-codex/luna", thinking: "low" });
  r.assistant(assistant());
  const report = r.finish(false)!;
  assert.equal(report.services.length, 3);
  assert.equal(report.services[2]?.calls, 2);
  assert.equal(report.models.length, 1);
  assert.match(reportLines(report).join("\n"), /compaction check/);
});

test("inactive requests and unavailable physical virtual models do not invent a report", () => {
  const r = new RequestReport(); r.assistant(assistant()); r.route(route());
  assert.equal(r.finish(false), undefined);
  r.start(); r.assistant(assistant("auto", { api: "pi-virtual" as never, provider: "jewter" }));
  assert.equal(r.finish(false), undefined);
});

test("reports are enabled by default independently from routing cards", () => {
  assert.equal(defaultConfig().ui.report, true);
  assert.equal(normalizeConfig({ ui: { cards: false } }).config.ui.report, true);
  assert.equal(normalizeConfig({ ui: { report: false } }).config.ui.report, false);
});

function harness() {
  const handlers = new Map<string, ((event: any, ctx: any) => Promise<unknown>)[]>();
  const appended: { type: string; data: any }[] = [];
  const config = defaultConfig();
  const ctx = {} as ExtensionContext;
  const pi = {
    on: (name: string, fn: (event: any, ctx: any) => Promise<unknown>) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn]);
    },
    registerEntryRenderer: () => {},
    appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
  } as unknown as ExtensionAPI;
  const tracker = registerReport(pi, () => config);
  const emit = async (type: string, event = {}) => { for (const fn of handlers.get(type) ?? []) await fn(event, ctx); };
  return { emit, appended, tracker, config };
}

test("extension appends one UI-only receipt at settled, not low-level agent_end", async () => {
  const h = harness();
  await h.emit("before_agent_start");
  h.tracker.route(route());
  await h.emit("message_end", { message: assistant() });
  await h.emit("agent_end"); assert.equal(h.appended.length, 0);
  await h.emit("agent_settled", { aborted: false });
  await h.emit("agent_settled", { aborted: false });
  assert.equal(h.appended.length, 1); assert.equal(h.appended[0]?.type, REPORT_ENTRY);
  assert.equal(h.appended[0]?.data.models[0].model, "openrouter/sol");
});

test("extension collects automatic pre-start compaction, not standalone manual compaction", async () => {
  const h = harness();
  await h.emit("session_before_compact", { reason: "manual" });
  h.tracker.service({ kind: "compaction", model: "x/manual" });
  await h.emit("session_before_compact", { reason: "threshold" });
  h.tracker.service({ kind: "compaction", model: "x/auto" });
  await h.emit("before_agent_start"); await h.emit("message_end", { message: assistant() });
  await h.emit("agent_settled", { aborted: false });
  assert.deepEqual(h.appended[0]?.data.services.map((s: any) => s.model), ["x/auto"]);
});

test("disabled reports don't append and session navigation resets pending data", async () => {
  const h = harness(); h.config.ui.report = false;
  await h.emit("before_agent_start"); await h.emit("message_end", { message: assistant() });
  await h.emit("agent_settled", { aborted: false }); assert.equal(h.appended.length, 0);
  h.config.ui.report = true;
  await h.emit("before_agent_start"); await h.emit("message_end", { message: assistant() });
  await h.emit("session_tree"); await h.emit("agent_settled", { aborted: false });
  assert.equal(h.appended.length, 0);
});

test("receipt omits Jev and prints a short Jewter line", () => {
  const r = new RequestReport(); r.start(); r.route(route());
  r.service({ kind: "compaction", model: "openai-codex/luna", thinking: "low" });
  r.assistant(assistant());
  const text = reportLines(r.finish(false)!).join("\n");
  assert.doesNotMatch(text, /Jev|typesafe|jev-1\.13/);
  assert.match(text, /Jewter: implementation\/medium/);
  assert.match(text, /openai-codex\/luna · low — LLM — compaction check/);
});

test("receipt shows a bare keep when no role was applied", () => {
  const r = new RequestReport(); r.start();
  r.route({ ...route(), role: undefined, tier: undefined, status: "keep", reason: "low-confidence", classifiedRole: "review", classifiedTier: "medium" });
  r.assistant(assistant());
  const text = reportLines(r.finish(false)!).join("\n");
  assert.match(text, /Jewter: keep/);
  assert.doesNotMatch(text, /review/);
});

test("receipt labels a first-request fallback without inventing a role", () => {
  const r = new RequestReport(); r.start();
  r.route({ ...route(), role: undefined, tier: undefined, status: "fallback", reason: "none-role", classifiedRole: "none" });
  r.assistant(assistant());
  const text = reportLines(r.finish(false)!).join("\n");
  assert.match(text, /Jewter: fallback/);
  assert.doesNotMatch(text, /Jewter: keep/);
});
