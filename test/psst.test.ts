import test from "node:test";
import assert from "node:assert/strict";
import { registerPsst } from "../src/commands/psst.ts";
import { defaultConfig } from "../src/config.ts";

function harness() {
  const handlers = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const events = new Map<string, (...args: any[]) => unknown>();
  const messages: string[] = [];
  const editor: string[] = [];
  const physical = { provider: "test", id: "fast", api: "openai-completions", reasoning: true, maxTokens: 1000 };
  const virtual = { provider: "jewter", id: "auto", api: "pi-virtual", reasoning: true };
  const config = defaultConfig();
  config.tiers.medium.model = "test/fast";
  const ctx: any = {
    cwd: "/repo", thinkingLevel: "medium", signal: undefined,
    sessionManager: { getSessionId: () => "session-1" },
    modelRegistry: {
      find: () => virtual,
      getAvailable: () => [physical],
      streamSimple: (model: any, prompt: any, options: any) => {
        assert.equal(model.id, "fast");
        assert.ok(prompt.systemPrompt.includes("read-only"));
        assert.equal(options.maxTokens, 1000);
        return { result: async () => ({ content: [{ type: "text", text: `answer-${prompt.messages.at(-1).content[0].text}` }] }) };
      },
    },
    ui: { notify: (message: string) => messages.push(message), setEditorText: (text: string) => editor.push(text) },
    isProjectTrusted: () => true,
  };
  const pi: any = {
    registerCommand: (name: string, options: any) => handlers.set(name, options.handler),
    on: (name: string, handler: any) => events.set(name, handler),
  };
  registerPsst(pi, () => config);
  return { handlers, events, messages, editor, ctx };
}

test("/psst routes each side request through Jewter and retains a separate bounded conversation", async () => {
  const h = harness();
  await h.handlers.get("psst")!("first", h.ctx);
  await h.handlers.get("psst")!("follow-up", h.ctx);
  await h.handlers.get("psst")!("inject", h.ctx);
  assert.ok(h.editor.length > 0);
  await h.handlers.get("psst")!("clear", h.ctx);
  await h.handlers.get("psst")!("inject", h.ctx);
  assert.ok(h.messages.some(message => message.includes("no answer")));
});

test("/psst reports unavailable router and resets its thread on session change", async () => {
  const h = harness();
  await h.handlers.get("psst")!("first", h.ctx);
  const newCtx = { ...h.ctx, sessionManager: { getSessionId: () => "session-2" }, modelRegistry: { ...h.ctx.modelRegistry, find: () => undefined } };
  await h.handlers.get("psst")!("question", newCtx);
  assert.ok(h.messages.some(message => message.includes("unavailable")));
});
