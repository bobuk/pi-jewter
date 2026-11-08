import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import { JevClient, resolveTransport } from "../jev/client.ts";
import type { JevQuestions, JevResponse } from "../jev/types.ts";
import type { RoutingRecord } from "../router/state.ts";
import { isChild } from "../ui/status.ts";
import { buildVerifyQuestions, buildVerifyState, decideVerify, isChangeTool, isShellTool, shouldAsk, suggestionPrompt, type RunFacts } from "./core.ts";

export const VERIFY_ENTRY = "jewter-verify";

export interface VerifyEntry {
  prompt: string;
  confidence: number;
  /** Whether the prompt was placed into an empty editor; otherwise `/jewter verify` inserts it. */
  inserted: boolean;
}

type Ask = (config: JewterConfig, state: Record<string, unknown>, questions: JevQuestions) => Promise<JevResponse>;

const askJev: Ask = async (config, state, questions) => {
  const resolved = resolveTransport(config.jev, process.env);
  if (!resolved.ok) throw new Error(resolved.error);
  return new JevClient({ transport: resolved.transport, timeoutMs: config.jev.timeoutMs }).ask(state, questions);
};

function textOf(message: unknown): string {
  const m = message as { role?: string; content?: unknown };
  if (m?.role !== "assistant" || !Array.isArray(m.content)) return "";
  return m.content.flatMap((c: { type?: string; text?: string }) => c.type === "text" && c.text ? [c.text] : []).join("\n");
}

/**
 * After a run that changed files, ask Jev whether a separate verification pass is
 * worth suggesting. A confident `suggest` places a ready prompt in an empty editor;
 * it is never sent automatically.
 */
export function registerVerify(pi: ExtensionAPI, getConfig: (ctx: ExtensionContext) => JewterConfig, ask: Ask = askJev) {
  let facts: RunFacts | undefined;
  const pending = new Map<string, { name: string; path?: string; command?: string }>();
  let run = 0;
  let inflight: Promise<void> = Promise.resolve();

  pi.registerEntryRenderer(VERIFY_ENTRY, (entry, _options, theme) => {
    const data = entry.data as VerifyEntry;
    const where = data.inserted ? "prompt is in the editor" : "/jewter verify puts the prompt in the editor";
    return new Text(`${theme.fg("accent", "Jewter · verification suggested")} ${theme.fg("dim", `(${Math.round(data.confidence * 100)}%) — ${where}`)}\n${theme.fg("dim", data.prompt)}`, 0, 0);
  });

  pi.on("before_agent_start", async event => {
    run++;
    pending.clear();
    facts = event.messageType === "user"
      ? { prompt: event.prompt, changedFiles: [], edits: 0, commands: [], toolErrors: 0, finalText: "", aborted: false }
      : undefined;
  });
  pi.on("tool_execution_start", async event => {
    if (!facts) return;
    const args = (event.args ?? {}) as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
    pending.set(event.toolCallId, { name: event.toolName, path, command: typeof args.command === "string" ? args.command : undefined });
  });
  pi.on("tool_execution_end", async event => {
    const call = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (!facts) return;
    if (event.isError) facts.toolErrors++;
    const name = call?.name ?? event.toolName;
    if (isChangeTool(name) && !event.isError) {
      facts.edits++;
      if (call?.path && !facts.changedFiles.includes(call.path)) facts.changedFiles.push(call.path);
    } else if (isShellTool(name) && call?.command) {
      facts.commands.push({ command: call.command, ok: !event.isError });
    }
  });
  pi.on("agent_end", async event => {
    if (!facts) return;
    const last = event.messages.findLast(m => textOf(m).trim());
    if (last) facts.finalText = textOf(last);
  });
  pi.on("agent_settled", async (event, ctx) => {
    const current = facts;
    facts = undefined;
    if (!current) return;
    current.aborted = event.aborted;
    const config = getConfig(ctx);
    const gate = { enabled: config.verify.enabled, routingEnabled: config.enabled && config.jev.enabled, child: isChild(ctx), hasUI: ctx.hasUI };
    if (!shouldAsk(current, gate)) return;
    const mine = run;
    // Do not hold up the settled run on a network call.
    inflight = (async () => {
      try {
        const decision = decideVerify(await ask(config, buildVerifyState(current), buildVerifyQuestions()), config.verify.minConfidence);
        if (!decision.suggest || mine !== run) return; // A newer request makes the hint stale.
        const prompt = suggestionPrompt(current);
        const inserted = ctx.ui.getEditorText().trim() === "";
        if (inserted) ctx.ui.setEditorText(prompt);
        pi.appendEntry<VerifyEntry>(VERIFY_ENTRY, { prompt, confidence: decision.confidence, inserted });
      } catch {
        // A failed hint is not worth interrupting the user; routing reports Jev errors already.
      }
    })();
  });
  const reset = () => { facts = undefined; pending.clear(); run++; };
  pi.on("session_start", async () => reset());
  pi.on("session_tree", async () => reset());
  pi.on("session_shutdown", async () => reset());

  return {
    route(record: RoutingRecord) { if (facts && record.role) facts.role = record.role; },
    /** Resolves when the latest background Jev check has finished (tests). */
    idle: () => inflight,
  };
}
