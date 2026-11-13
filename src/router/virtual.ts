import { contextRecorder } from "../service/context.ts";
import { clampThinkingLevel, type Message, type Model, type Api } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { resolveTier, type JewterConfig, type TierName } from "../config.ts";
import { JevClient, resolveTransport } from "../jev/client.ts";
import { buildJevQuestions, buildJevState, decide } from "../jev/decide.ts";
import type { RouterState, RoutingRecord } from "./state.ts";

export type Observer = (record: RoutingRecord, ctx: ExtensionContext) => void;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function lastUserText(messages: readonly Message[]): string {
  const msg = messages.findLast(m => m.role === "user");
  if (!msg || msg.role !== "user") return "";
  return typeof msg.content === "string" ? msg.content : msg.content.flatMap(c => c.type === "text" ? [c.text] : []).join("\n");
}

function textOf(message: Message): string {
  if (message.role === "user") return typeof message.content === "string" ? message.content : message.content.flatMap(c => c.type === "text" ? [c.text] : []).join("\n");
  if (message.role === "assistant") return message.content.flatMap(c => c.type === "text" ? [c.text] : []).join("\n");
  return "";
}

/** The exchange before the latest user prompt, bounded: earlier user request and the assistant reply. */
export function previousExchange(messages: readonly Message[]): string | undefined {
  const last = messages.findLastIndex(m => m.role === "user");
  if (last <= 0) return undefined;
  const before = messages.slice(0, last);
  const assistant = before.findLast(m => m.role === "assistant" && textOf(m).trim());
  const user = before.findLast(m => m.role === "user" && textOf(m).trim());
  const parts: string[] = [];
  if (user) parts.push(`User: ${textOf(user).trim().slice(0, 500)}`);
  if (assistant) {
    const text = textOf(assistant).trim();
    parts.push(`Assistant: ${text.length > 1500 ? `${text.slice(0, 600)}\n[…]\n${text.slice(-900)}` : text}`);
  }
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Bounded evidence since the latest user message; never send thinking or image bytes. */
export function stepContext(messages: readonly Message[]): string {
  const lastUser = messages.findLastIndex(m => m.role === "user");
  const parts = messages.slice(lastUser + 1).slice(-8).flatMap(message => {
    if (message.role === "assistant") {
      return message.content.flatMap(block => {
        if (block.type === "text") return [`Assistant: ${bounded(block.text, 1500)}`];
        if (block.type === "toolCall") return [`Tool call ${block.name}: ${bounded(JSON.stringify(block.arguments), 1000)}`];
        return [];
      });
    }
    if (message.role === "toolResult") {
      const text = message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
      return [`Tool result ${message.toolName}${message.isError ? " (error)" : ""}: ${bounded(text, 2000)}`];
    }
    return [];
  });
  return bounded(parts.join("\n\n"), 8000);
}

function bounded(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor((max - 5) / 2);
  return `${text.slice(0, head)}\n[…]\n${text.slice(-(max - head - 5))}`.slice(0, max);
}

/** Match an exact physical model in the authenticated registry, never another virtual router. */
export function findPhysical(ctx: ExtensionContext, ref: string | undefined): Model<Api> | undefined {
  if (!ref) return;
  return ctx.modelRegistry.getAvailable().find(m => `${m.provider}/${m.id}` === ref && m.api !== "pi-virtual");
}

export interface RouterDeps {
  getContext: () => ExtensionContext | undefined;
  getConfig: (ctx: ExtensionContext) => JewterConfig;
  observe: Observer;
  diagnostic?: ReturnType<typeof contextRecorder>;
  classify?: (config: JewterConfig, prompt: string, role: string | undefined, signal?: AbortSignal, previous?: string, step?: string) => Promise<{ response: Awaited<ReturnType<JevClient["ask"]>>; transport: string; classifierModel?: string }>;
}

export async function classify(config: JewterConfig, prompt: string, role?: string, signal?: AbortSignal, previous?: string, step?: string, diagnostic?: ReturnType<typeof contextRecorder>) {
  const resolved = resolveTransport(config.jev, process.env);
  if (!resolved.ok) throw new Error(resolved.error);
  const client = new JevClient({ transport: resolved.transport, timeoutMs: config.jev.timeoutMs, diagnostic });
  const response = await client.ask(buildJevState(prompt, role, previous, step), buildJevQuestions(config), signal);
  return { response, transport: resolved.transport.id, classifierModel: response.model ?? resolved.transport.model };
}

/** The first request needs a configured physical fallback; never silently pick an arbitrary model. */
function fallback(ctx: ExtensionContext, config: JewterConfig, role: string, request: ModelRouteRequest<RouterState>): ModelRoute<RouterState> {
  const previous = request.failed ?? request.previous;
  if (previous) return { model: previous.model, thinkingLevel: previous.thinkingLevel ?? request.thinkingLevel };
  for (const tier of ["medium", "fast", "strong"] as TierName[]) {
    const target = resolveTier(config, role, tier);
    const model = findPhysical(ctx, target.model);
    if (model) return { model, thinkingLevel: clampThinkingLevel(model, target.thinking === "auto" ? request.thinkingLevel : target.thinking) };
  }
  throw new Error("Jewter: no previous model and no available fallback. Configure at least one tier in /jewter.");
}

export function createRoute(deps: RouterDeps, defaultRole?: string) {
  return async (request: ModelRouteRequest<RouterState>): Promise<ModelRoute<RouterState>> => {
    const ctx = deps.getContext();
    if (!ctx) throw new Error("Jewter: session context is not initialized");
    const config = deps.getConfig(ctx);
    const role = request.state?.role ?? defaultRole ?? "quick";
    const isStep = request.reason === "continuation" && config.routing.mode === "step";
    if (request.reason !== "user" && !isStep) return fallback(ctx, config, role, request);
    const start = Date.now();
    const previous = request.previous;
    const previousModel = previous && `${previous.model.provider}/${previous.model.id}`;
    const record: RoutingRecord = { at: new Date().toISOString(), status: "keep", elapsedMs: 0, previousModel };
    const keep = (reason: string): ModelRoute<RouterState> => {
      record.reason = reason;
      const selected = fallback(ctx, config, role, request);
      record.status = previous ? "keep" : "fallback";
      record.model = `${selected.model.provider}/${selected.model.id}`;
      record.thinking = selected.thinkingLevel;
      record.role = request.state?.role ?? defaultRole;
      record.tier = request.state?.tier;
      record.elapsedMs = Date.now() - start;
      const state = { ...request.state, role: record.role, model: record.model, decision: record };
      deps.observe(record, ctx);
      return { ...selected, state };
    };
    if (!config.enabled || !config.jev.enabled) return keep("disabled");
    try {
      const args: Parameters<NonNullable<RouterDeps["classify"]>> = [config, lastUserText(request.messages), request.state?.role, request.signal, previousExchange(request.messages), isStep ? stepContext(request.messages) : undefined];
      const result = await (deps.classify ? deps.classify(...args) : classify(...args, deps.diagnostic));
      record.transport = result.transport;
      record.classifierModel = result.classifierModel;
      const decision = decide({ response: result.response, config, currentRole: request.state?.role, currentTier: request.state?.tier });
      record.decision = decision;
      if (decision.role) {
        record.classifiedRole = decision.role;
        if (decision.tierSource !== "fallback-missing") record.classifiedTier = decision.tier;
      }
      // A matching role/tier can still resolve to a different model after a config change.
      if ((decision.action === "keep" && decision.keepReason !== "same") || !decision.role) return keep(decision.keepReason ?? "unchanged");
      const target = resolveTier(config, decision.role, decision.tier);
      const model = findPhysical(ctx, target.model);
      if (!model) return keep(`unavailable model: ${target.model ?? `${decision.role}/${decision.tier} is unset`}`);
      // Cache-loss hysteresis is charged only for physical switches inside a user request.
      // It is a confidence heuristic, not a token-price estimate; same-model thinking changes are free.
      if (isStep && previous && previousModel !== `${model.provider}/${model.id}` && config.routing.cachePenalty > 0) {
        const threshold = Math.min(1, config.jev.minConfidence + config.routing.cachePenalty);
        if (decision.roleConfidence < threshold || decision.scoreConfidence < threshold || decision.tierSource !== "jev") {
          return keep(`cache-penalty: switch requires role and complexity confidence >= ${threshold.toFixed(2)}`);
        }
      }
      const thinkingLevel = clampThinkingLevel(model, target.thinking === "auto" ? request.thinkingLevel : target.thinking);
      record.status = previousModel === `${model.provider}/${model.id}` && previous?.thinkingLevel === thinkingLevel ? "keep" : "switch";
      record.model = `${model.provider}/${model.id}`;
      record.thinking = thinkingLevel;
      record.role = decision.role;
      record.tier = decision.tier;
      record.elapsedMs = Date.now() - start;
      const state: RouterState = { role: decision.role, tier: decision.tier, model: record.model, decision: record };
      deps.observe(record, ctx);
      return { model, thinkingLevel, state };
    } catch (error) {
      if (request.signal?.aborted) throw error;
      return keep(`Jev error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

export function registerRouters(pi: ExtensionAPI, deps: RouterDeps) {
  const registered = new Set<string>();
  return (config: JewterConfig, extraIds: readonly string[] = []) => {
    const ids = new Set(["auto", ...Object.keys(config.roles), ...extraIds].filter(id => id !== "none"));
    for (const id of registered) if (!ids.has(id)) { pi.unregisterVirtualModel("jewter", id); registered.delete(id); }
    for (const id of ids) {
      if (registered.has(id)) continue;
      pi.registerVirtualModel<RouterState>({ provider: "jewter", id, name: `Jewter ${id}`, thinkingLevels: [...LEVELS], route: createRoute({ ...deps, diagnostic: contextRecorder(pi, "routing") }, id === "auto" ? undefined : id) });
      registered.add(id);
    }
  };
}
