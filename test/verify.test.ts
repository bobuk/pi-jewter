import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defaultConfig, normalizeConfig } from "../src/config.ts";
import { buildVerifyQuestions, buildVerifyState, decideVerify, isChangeTool, isPotentiallyMutatingCommand, isPotentiallyMutatingTool, isTestCommand, shouldAsk, suggestionPrompt, type RunFacts } from "../src/verify/core.ts";
import { registerVerify, VERIFY_ENTRY } from "../src/verify/extension.ts";
import type { JevResponse } from "../src/jev/types.ts";

const facts = (over: Partial<RunFacts> = {}): RunFacts => ({
  prompt: "fix the retry bug", changedFiles: ["src/retry.ts"], indirectChanges: [], edits: 1, indirectEdits: 0, commands: [], tests: [], toolErrors: 0, finalText: "Done.", aborted: false, ...over,
});
const gate = { enabled: true, routingEnabled: true, child: false, hasUI: true };
const answer = (choice: string, confidence: number): JevResponse => ({ answers: { verify: { choice, confidence, probabilities: { [choice]: confidence } } } });

test("verification hints are on by default and configurable", () => {
  assert.deepEqual(defaultConfig().verify, { enabled: true, minConfidence: 0.8 });
  assert.deepEqual(normalizeConfig({ verify: { enabled: false, minConfidence: 0.2 } }).config.verify, { enabled: false, minConfidence: 0.5 });
});

test("Jev is asked only after finished interactive main-session runs that changed files outside verification", () => {
  assert.equal(shouldAsk(facts(), gate), true);
  assert.equal(shouldAsk(facts({ edits: 0, changedFiles: [], indirectEdits: 0 }), gate), false);
  assert.equal(shouldAsk(facts({ edits: 0, changedFiles: [], indirectEdits: 1 }), gate), true);
  assert.equal(shouldAsk(facts({ aborted: true }), gate), false);
  assert.equal(shouldAsk(facts({ role: "verification" }), gate), false);
  assert.equal(shouldAsk(facts(), { ...gate, child: true }), false);
  assert.equal(shouldAsk(facts(), { ...gate, hasUI: false }), false);
  assert.equal(shouldAsk(facts(), { ...gate, enabled: false }), false);
  assert.equal(shouldAsk(facts(), { ...gate, routingEnabled: false }), false);
});

test("only a confident suggest produces a hint", () => {
  assert.equal(decideVerify(answer("suggest", 0.9), 0.8).suggest, true);
  assert.equal(decideVerify(answer("suggest", 0.7), 0.8).suggest, false);
  assert.equal(decideVerify(answer("skip", 0.99), 0.8).suggest, false);
  assert.equal(decideVerify({ answers: {} }, 0.8).suggest, false);
  assert.equal(decideVerify(answer("suggest", 1.5), 0.8).suggest, false);
});

test("test and mutation commands are conservatively recognized", () => {
  for (const command of ["npm test", "npm run test -- --watch", "pnpm vitest run", "yarn test", "bun test", "node --test", "pytest -q", "cargo test", "go test ./...", "swift test", "npx playwright test", "npm run check"]) assert.equal(isTestCommand(command), true, command);
  for (const command of ["npm run build", "npm run typecheck", "npm run lint", "git status", "cat package.json"]) assert.equal(isTestCommand(command), false, command);
  for (const command of ["git apply changes.patch", "patch -p1 < x.patch", "sed -i '' s/a/b/ file.ts", "npm version patch", "npx prisma generate", "cargo fmt"]) assert.equal(isPotentiallyMutatingCommand(command), true, command);
  for (const command of ["git status", "npm test", "npm run typecheck", "cat src/main.ts"]) assert.equal(isPotentiallyMutatingCommand(command), false, command);
  assert.equal(isPotentiallyMutatingTool("apply_patch"), true);
  assert.equal(isPotentiallyMutatingTool("filesystem_write"), true);
  assert.equal(isPotentiallyMutatingTool("some_read_tool"), false);
});

test("Jev state is bounded and factual", () => {
  const state = buildVerifyState(facts({
    prompt: "x".repeat(10_000), finalText: "y".repeat(5000),
    changedFiles: Array.from({ length: 50 }, (_, i) => `f${i}.ts`),
    indirectChanges: Array.from({ length: 10 }, (_, i) => `gen${i}.ts`), indirectEdits: 3,
    tests: Array.from({ length: 15 }, (_, i) => ({ command: `npm test ${i}`, ok: i % 2 === 0 })),
    commands: Array.from({ length: 20 }, (_, i) => ({ command: `npm test ${i} ${"z".repeat(300)}`, ok: i % 2 === 0 })),
  }));
  assert.ok((state.request as string).length < 4100);
  assert.ok((state.final_message as string).length < 1600);
  assert.equal((state.changed_files as string[]).length, 40);
  assert.equal(state.indirect_edit_calls, 3);
  assert.equal((state.tests as string[]).length, 12);
  assert.match((state.tests as string[])[0]!, /^failed: npm test 3/);
  assert.match((state.tests as string[])[1]!, /^passed: npm test 4/);
  const commands = state.commands as string[];
  assert.equal(commands.length, 12); assert.match(commands[0]!, /^ok: npm test 8/); assert.match(commands[1]!, /^failed: /);
  assert.ok(commands.every(c => c.length <= 210));
  assert.deepEqual(Object.keys(buildVerifyQuestions().verify!.criteria as object), ["suggest", "skip"]);
});

test("suggested prompt follows the user's script and names changed files", () => {
  assert.match(suggestionPrompt(facts()), /^Verify the changes .*retry\.ts/);
  assert.match(suggestionPrompt(facts({ prompt: "почини ретраи" })), /^Проверь изменения .*retry\.ts/);
  assert.match(suggestionPrompt(facts({ changedFiles: ["a", "b", "c", "d", "e", "f", "g"] })), /\(\+2\)/);
  assert.equal(isChangeTool("edit"), true); assert.equal(isChangeTool("multi_edit"), true); assert.equal(isChangeTool("read"), false);
});

function harness(reply: JevResponse | Error = answer("suggest", 0.9), delayMs = 0) {
  const handlers = new Map<string, ((event: any, ctx: any) => Promise<unknown>)[]>();
  const appended: { type: string; data: any }[] = [];
  const asked: Record<string, unknown>[] = [];
  const config = defaultConfig();
  let editor = "";
  const ctx = { hasUI: true, sessionManager: { getSessionFile: () => "/s/main.jsonl" }, ui: { getEditorText: () => editor, setEditorText: (t: string) => { editor = t; } } };
  const pi = {
    on: (name: string, fn: (event: any, ctx: any) => Promise<unknown>) => { handlers.set(name, [...(handlers.get(name) ?? []), fn]); },
    registerEntryRenderer: () => {},
    appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
  } as unknown as ExtensionAPI;
  const verify = registerVerify(pi, () => config, async (_c, state) => { asked.push(state); if (delayMs) await new Promise(r => setTimeout(r, delayMs)); if (reply instanceof Error) throw reply; return reply; });
  const emit = async (type: string, event = {}) => { for (const fn of handlers.get(type) ?? []) await fn(event, ctx); };
  const runWithEdit = async (prompt = "fix the retry bug") => {
    await emit("before_agent_start", { messageType: "user", prompt });
    await emit("tool_call", { toolCallId: "1", toolName: "edit", input: { path: "src/retry.ts" } });
    await emit("tool_result", { toolCallId: "1", toolName: "edit", input: { path: "src/retry.ts" }, isError: false });
    await emit("tool_call", { toolCallId: "2", toolName: "bash", input: { command: "npm test" } });
    await emit("tool_result", { toolCallId: "2", toolName: "bash", input: { command: "npm test" }, isError: true });
    await emit("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "Fixed." }] }] });
  };
  return { emit, appended, asked, config, verify, runWithEdit, editor: () => editor, setEditor: (t: string) => { editor = t; } };
}

test("a successful shell edit is observed even without Pi edit/write tools", async () => {
  const h = harness();
  await h.emit("before_agent_start", { messageType: "user", prompt: "apply the patch" });
  await h.emit("tool_call", { toolCallId: "p", toolName: "bash", input: { command: "git apply fix.patch" } });
  await h.emit("tool_result", { toolCallId: "p", toolName: "bash", input: { command: "git apply fix.patch" }, isError: false });
  await h.emit("agent_settled", { aborted: false }); await h.verify.idle();
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0]?.indirect_edit_calls, 1);
  assert.match((h.asked[0]?.indirect_changes as string[])[0]!, /bash command/);
});

test("successful third-party patch tools contribute observed file paths", async () => {
  const h = harness();
  await h.emit("before_agent_start", { messageType: "user", prompt: "apply generated fixes" });
  await h.emit("tool_call", { toolCallId: "p", toolName: "apply_patch", input: { path: "src/generated.ts" } });
  await h.emit("tool_result", { toolCallId: "p", toolName: "apply_patch", input: { path: "src/generated.ts" }, isError: false });
  await h.emit("agent_settled", { aborted: false }); await h.verify.idle();
  assert.deepEqual(h.asked[0]?.changed_files, ["src/generated.ts"]);
});

test("a confident suggestion fills an empty editor and records a UI-only entry", async () => {
  const h = harness();
  await h.runWithEdit();
  await h.emit("agent_settled", { aborted: false }); await h.verify.idle();
  assert.deepEqual(h.asked[0]?.changed_files, ["src/retry.ts"]);
  assert.deepEqual(h.asked[0]?.commands, ["failed: npm test"]);
  assert.deepEqual(h.asked[0]?.tests, ["failed: npm test"]);
  assert.equal(h.asked[0]?.final_message, "Fixed.");
  assert.match(h.editor(), /^Verify the changes/);
  assert.equal(h.appended[0]?.type, VERIFY_ENTRY); assert.equal(h.appended[0]?.data.inserted, true);
});

test("the user's draft is never overwritten", async () => {
  const h = harness(); h.setEditor("my draft");
  await h.runWithEdit(); await h.emit("agent_settled", { aborted: false }); await h.verify.idle();
  assert.equal(h.editor(), "my draft"); assert.equal(h.appended[0]?.data.inserted, false);
});

test("skip, Jev errors, verification runs and runs without edits stay silent", async () => {
  for (const reply of [answer("skip", 0.99), new Error("down")]) {
    const h = harness(reply); await h.runWithEdit(); await h.emit("agent_settled", { aborted: false }); await h.verify.idle();
    assert.equal(h.appended.length, 0); assert.equal(h.editor(), "");
  }
  const v = harness(); await v.runWithEdit();
  v.verify.route({ role: "verification" } as never);
  await v.emit("agent_settled", { aborted: false }); await v.verify.idle();
  assert.equal(v.asked.length, 0);
  const n = harness();
  await n.emit("before_agent_start", { messageType: "user", prompt: "what does this do?" });
  await n.emit("agent_settled", { aborted: false }); await n.verify.idle();
  assert.equal(n.asked.length, 0);
});

test("a newer request makes a pending hint stale", async () => {
  const h = harness(answer("suggest", 0.9), 20);
  await h.runWithEdit(); await h.emit("agent_settled", { aborted: false });
  await h.emit("before_agent_start", { messageType: "user", prompt: "next" });
  await h.verify.idle();
  assert.equal(h.appended.length, 0); assert.equal(h.editor(), "");
});
