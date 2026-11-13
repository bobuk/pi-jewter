import { contextRecorder, isContextError } from "../service/context.ts";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import { JevClient, resolveTransport } from "../jev/client.ts";
import type { JevQuestions, JevResponse } from "../jev/types.ts";
import type { RoutingRecord } from "../router/state.ts";
import { isChild } from "../ui/status.ts";
import { buildVerifyQuestions, buildVerifyState, decideVerify, isChangeTool, isPotentiallyMutatingCommand, isPotentiallyMutatingTool, isShellTool, isTestCommand, shouldAsk, suggestionPrompt, type RunFacts } from "./core.ts";

export const VERIFY_ENTRY = "jewter-verify";

export interface VerifyEntry {
  prompt: string;
  confidence: number;
  /** Whether the prompt was placed into an empty editor; otherwise `/jewter verify` inserts it. */
  inserted: boolean;
}

type Ask = (config: JewterConfig, state: Record<string, unknown>, questions: JevQuestions) => Promise<JevResponse>;

const askJev = async (config: JewterConfig, state: Record<string, unknown>, questions: JevQuestions, diagnostic?: ReturnType<typeof contextRecorder>, signal?: AbortSignal) => {
  const resolved = resolveTransport(config.jev, process.env);
  if (!resolved.ok) throw new Error(resolved.error);
  return new JevClient({ transport: resolved.transport, timeoutMs: config.jev.timeoutMs, diagnostic }).ask(state, questions, signal);
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
export function registerVerify(pi: ExtensionAPI, getConfig: (ctx: ExtensionContext) => JewterConfig, ask?: Ask) {
  let facts: RunFacts | undefined;
  const pending = new Map<string, { name: string; path?: string; command?: string; mutatingCommand: boolean }>();
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
      ? { prompt: event.prompt, changedFiles: [], indirectChanges: [], edits: 0, indirectEdits: 0, commands: [], tests: [], toolErrors: 0, finalText: "", aborted: false }
      : undefined;
  });
  pi.on("tool_call", async event => {
    if (!facts) return;
    const args = event.input as Record<string, unknown>;
    const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
    const command = typeof args.command === "string" ? args.command : undefined;
    const stateChanging = command ? isPotentiallyMutatingCommand(command) : isPotentiallyMutatingTool(event.toolName);
    pending.set(event.toolCallId, { name: event.toolName, path, command, mutatingCommand: stateChanging });
  });
  pi.on("tool_result", async event => {
    const call = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (!facts) return;
    if (event.isError) facts.toolErrors++;
    const name = call?.name ?? event.toolName;
    if ((isChangeTool(name) || name === "edit" || name === "write") && !event.isError) {
      facts.edits++;
      if (call?.path && !facts.changedFiles.includes(call.path)) facts.changedFiles.push(call.path);
    } else if (isShellTool(name) && call?.command) {
      const ok = !event.isError;
      facts.commands.push({ command: call.command, ok });
      if (isTestCommand(call.command)) facts.tests.push({ command: call.command, ok });
      if (call.mutatingCommand && ok) {
        facts.indirectEdits++;
        if (call.path && !facts.indirectChanges.includes(call.path)) facts.indirectChanges.push(call.path);
        else if (!call.path) facts.indirectChanges.push(`${name} command (target not exposed)`);
      }
    } else if (!isShellTool(name) && isPotentiallyMutatingTool(name) && call?.mutatingCommand && !event.isError) {
      facts.indirectEdits++;
      if (call.path && !facts.indirectChanges.includes(call.path)) facts.indirectChanges.push(call.path);
      else if (!call.path) facts.indirectChanges.push(`${name} (target not exposed)`);
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
    const recordContext = contextRecorder(pi, "verification");
    const diagnostic: ReturnType<typeof contextRecorder> = (service, event) => { if (mine === run) recordContext(service, event); };
    // Do not hold up the settled run on a network call.
    inflight = (async () => {
      try {
        const decision = decideVerify(await (ask ? ask(config, buildVerifyState(current), buildVerifyQuestions()) : askJev(config, buildVerifyState(current), buildVerifyQuestions(), diagnostic, ctx.signal)), config.verify.minConfidence);
        if (!decision.suggest || mine !== run) return; // A newer request makes the hint stale.
        const prompt = suggestionPrompt(current);
        const inserted = ctx.ui.getEditorText().trim() === "";
        if (inserted) ctx.ui.setEditorText(prompt);
        pi.appendEntry<VerifyEntry>(VERIFY_ENTRY, { prompt, confidence: decision.confidence, inserted });
      } catch (error) {
        if (ask && isContextError(error)) diagnostic("jev", "provider-overflow");
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
