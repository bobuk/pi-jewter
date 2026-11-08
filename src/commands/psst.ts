import type { Context as PromptContext, Model, Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import { createRoute, findPhysical } from "../router/virtual.ts";

const SYSTEM = "You are Jewter's read-only side conversation. Answer the user's question using only the supplied conversation and retrieved context. You have no tools and cannot modify files. Clearly say when you lack enough context. Keep answers concise.";
const MAX_TURNS = 12;
const MAX_CHARS = 24_000;

type Turn = { question: string; answer: string };
let turns: Turn[] = [];
let activeContext: ExtensionContext | undefined;
let activeController: AbortController | undefined;

/** Stateful Jev-routed, read-only side conversation. Its history is kept in memory per session. */
export function registerPsst(
  pi: ExtensionAPI,
  getConfig: (ctx: ExtensionCommandContext) => JewterConfig,
): void {
  let owner: string | undefined;
  const resetForSession = (ctx: ExtensionCommandContext) => {
    const id = ctx.sessionManager.getSessionId();
    if (owner !== id) {
      activeController?.abort();
      owner = id;
      turns = [];
    }
  };
  let requestQueue: Promise<void> = Promise.resolve();

  pi.on("session_start", async (_event, ctx) => {
    owner = ctx.sessionManager.getSessionId();
    activeController?.abort();
    turns = [];
  });
  pi.registerCommand("psst", {
    description: "Ask a read-only Jev-routed side question; /psst clear resets it; /psst abort cancels it",
    handler: async (args, ctx) => {
      resetForSession(ctx);
      const input = args.trim();
      if (/^abort$/i.test(input)) {
        if (!activeController) ctx.ui.notify("No /psst request is running.", "info");
        else { activeController.abort(); ctx.ui.notify("/psst request cancelled.", "info"); }
        return;
      }
      const previous = requestQueue;
      const route = createRoute({
        getContext: () => activeContext,
        getConfig: (context) => getConfig(context as ExtensionCommandContext),
        observe: () => {},
      });
      const current = previous.then(() => handlePsst(input, ctx, route));
      requestQueue = current.catch(() => {});
      await current;
    },
  });
}

async function handlePsst(input: string, ctx: ExtensionCommandContext, route: ReturnType<typeof createRoute>): Promise<void> {
  if (!input) {
    ctx.ui.notify("Usage: /psst <question> | /psst clear | /psst inject | /psst abort", "info");
    return;
  }
  if (/^clear$/i.test(input)) {
    activeController?.abort();
    turns = [];
    ctx.ui.notify("/psst conversation cleared.", "info");
    return;
  }
  if (/^inject$/i.test(input)) {
    if (turns.length === 0) { ctx.ui.notify("/psst has no answer to inject.", "info"); return; }
    const handoff = turns.map((turn, i) => `Q${i + 1}: ${turn.question}\nA${i + 1}: ${turn.answer}`).join("\n\n");
    ctx.ui.setEditorText(`Context from /psst (read-only side conversation):\n\n${handoff}\n\nPlease use this context to help with my request: `);
    return;
  }
  const available = ctx.modelRegistry.find("jewter", "auto") as Model<Api> | undefined;
  if (!available) { ctx.ui.notify("Jewter router jewter/auto is unavailable; reload Pi or check the Jewter extension.", "error"); return; }
  // Routing context is supplied explicitly per invocation, never shared with the main-session router.
  const signal = new AbortController();
  activeController = signal;
  const virtualMessage = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() });
  const context: PromptContext = {
    systemPrompt: `${SYSTEM}\n\nCurrent working directory: ${ctx.cwd}`,
    messages: [
      ...turns.flatMap(turn => [virtualMessage(turn.question), { role: "assistant" as const, content: [{ type: "text" as const, text: turn.answer }], api: "openai-completions" as const, provider: "jewter", model: "auto", stopReason: "stop" as const, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }]),
      virtualMessage(input),
    ],
  };
  const request = { reason: "user", model: available, thinkingLevel: ctx.thinkingLevel ?? "medium", messages: context.messages, signal: signal.signal } as const;
  activeContext = ctx;
  try {
    ctx.ui.notify("/psst: asking Jev for a suitable model…", "info");
    const selected = await route(request as never);
    if (signal.signal.aborted) return;
    const model = selected.model as Model<Api>;
    if (!findPhysical(ctx, `${model.provider}/${model.id}`)) throw new Error("Jev selected a model that is not physically available.");
    // Classification above provides the selected physical route. ModelRegistry still
    // resolves credentials and provider options for that model.
    const response = await ctx.modelRegistry.streamSimple(model, context, {
      reasoning: selected.thinkingLevel === "off" ? undefined : selected.thinkingLevel,
      maxTokens: Math.min(model.maxTokens || 4096, 4096),
      signal: signal.signal,
    }).result();
    const answer = response.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
    if (!answer) throw new Error("The selected model returned no text answer.");
    turns = [...turns, { question: input, answer }].slice(-MAX_TURNS);
    while (turns.reduce((n, t) => n + t.question.length + t.answer.length, 0) > MAX_CHARS) turns.shift();
    ctx.ui.notify(`/psst · ${model.provider}/${model.id}\n\n${answer}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`/psst failed: ${message}`, "error");
  } finally {
    activeContext = undefined;
    if (activeController === signal) activeController = undefined;
  }
}
