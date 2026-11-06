import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RoutingRecord } from "../router/state.ts";

/** Direct model calls (not assistant-loop responses), observed by Jewter itself. */
export interface ServiceCall {
  kind: "classifier" | "compaction";
  purpose?: "routing" | "compaction";
  model: string;
  transport?: string;
  thinking?: string;
  failed?: boolean;
}

export interface ModelWork {
  model: string;
  thinking?: string;
  roles: string[];
  responses: number;
  textResponses: number;
  failures: number;
  aborted: number;
  incomplete: number;
  tools: Record<string, number>;
  toolErrors: number;
  /** Called but blocked/invalid before tool execution. Not counted as work done. */
  skippedTools: number;
}

export interface ModelReport {
  version: 1;
  elapsedMs: number;
  aborted: boolean;
  models: ModelWork[];
  services: (ServiceCall & { calls: number })[];
  routes: RoutingRecord[];
}

/** One collection spans retries and automatic continuations until agent_settled. */
export class RequestReport {
  private started?: number;
  private models = new Map<string, ModelWork>();
  private services = new Map<string, ServiceCall & { calls: number }>();
  private owners = new Map<string, ModelWork>();
  private routes: RoutingRecord[] = [];
  private currentRoute?: RoutingRecord;

  start(now = Date.now()): void {
    if (this.started === undefined) this.started = now;
  }

  reset(): void {
    this.started = undefined;
    this.models.clear();
    this.services.clear();
    this.owners.clear();
    this.routes = [];
    this.currentRoute = undefined;
  }

  route(record: RoutingRecord): void {
    if (this.started === undefined) return;
    this.routes.push(record);
    this.currentRoute = record;
    // No classifier call was made for disabled routing; don't invent one.
    if (record.classifierModel && record.decision) {
      this.service({ kind: "classifier", purpose: "routing", model: record.classifierModel, transport: record.transport });
    }
  }

  service(call: ServiceCall): void {
    if (this.started === undefined) return;
    const key = JSON.stringify([call.kind, call.purpose, call.model, call.transport, call.thinking, !!call.failed]);
    const existing = this.services.get(key);
    if (existing) existing.calls++;
    else this.services.set(key, { ...call, calls: 1 });
  }

  assistant(message: AssistantMessage): void {
    if (this.started === undefined || message.api === "pi-virtual") return;
    const model = `${message.provider}/${message.model}`;
    const key = JSON.stringify([model, message.thinkingLevel]);
    let work = this.models.get(key);
    if (!work) {
      work = { model, thinking: message.thinkingLevel, roles: [], responses: 0, textResponses: 0, failures: 0, aborted: 0, incomplete: 0, tools: {}, toolErrors: 0, skippedTools: 0 };
      this.models.set(key, work);
    }
    work.responses++;
    if (message.stopReason === "error") work.failures++;
    if (message.stopReason === "aborted") work.aborted++;
    if (message.stopReason === "length") work.incomplete++;
    // Don't call failed or token-limited partial text a completed answer.
    if (!["error", "aborted", "length"].includes(message.stopReason) && message.content.some(c => c.type === "text" && c.text.trim())) work.textResponses++;
    if (this.currentRoute?.role && this.currentRoute.model === model && !work.roles.includes(this.currentRoute.role)) work.roles.push(this.currentRoute.role);
    for (const block of message.content) {
      if (block.type === "toolCall") this.owners.set(block.id, work);
    }
  }

  toolStart(event: { toolCallId: string; parentToolCallId?: string }): void {
    if (this.started === undefined || !event.parentToolCallId) return;
    const owner = this.owners.get(event.parentToolCallId);
    if (owner) this.owners.set(event.toolCallId, owner);
  }

  toolEnd(event: { toolCallId: string; parentToolCallId?: string; toolName: string; isError: boolean; durationMs?: number }): void {
    if (this.started === undefined) return;
    const owner = this.owners.get(event.toolCallId) ?? (event.parentToolCallId ? this.owners.get(event.parentToolCallId) : undefined);
    if (!owner) return; // No reliable ownership; never attribute it to the last model by guesswork.
    // Permit tool-of-tool calls to trace through the same owner.
    this.owners.set(event.toolCallId, owner);
    if (event.durationMs === undefined) { owner.skippedTools++; return; }
    owner.tools[event.toolName] = (owner.tools[event.toolName] ?? 0) + 1;
    if (event.isError) owner.toolErrors++;
  }

  finish(aborted: boolean, now = Date.now()): ModelReport | undefined {
    if (this.started === undefined) return undefined;
    const report: ModelReport = { version: 1, elapsedMs: Math.max(0, now - this.started), aborted, models: [...this.models.values()], services: [...this.services.values()], routes: this.routes };
    this.reset();
    if (!report.models.length && !report.services.length && !report.routes.length) return undefined;
    return report;
  }
}

/** Factual tool labels, not an LLM-generated claim about correctness or completed tests. */
export function toolWork(tools: Record<string, number>): string {
  return Object.entries(tools).map(([name, count]) => `${name} ×${count}`).join(", ");
}

export function reportLines(report: ModelReport): string[] {
  const interrupted = report.aborted ? " · interrupted" : "";
  const lines = [`Models · ${(report.elapsedMs / 1000).toFixed(1)} s${interrupted}`];
  for (const service of report.services) {
    // Jev is a classifier, not work on the request; only real fallback LLM calls are listed.
    if (service.kind === "classifier") continue;
    lines.push(`  ${service.failed ? "request to " : ""}${service.model}${service.thinking ? ` · ${service.thinking}` : ""} — LLM — compaction check, calls: ${service.calls}${service.failed ? " (failed or aborted)" : ""}`);
  }
  for (const work of report.models) {
    const actions: string[] = [];
    if (work.roles.length) actions.push(`role: ${work.roles.join(" → ")}`);
    const tools = toolWork(work.tools);
    if (tools) actions.push(tools);
    if (work.textResponses) actions.push(`text answers: ${work.textResponses}`);
    actions.push(`LLM requests: ${work.responses}`);
    if (work.failures) actions.push(`model errors: ${work.failures}`);
    if (work.aborted) actions.push(`aborted answers: ${work.aborted}`);
    if (work.incomplete) actions.push(`token-limited answers: ${work.incomplete}`);
    if (work.toolErrors) actions.push(`tool errors: ${work.toolErrors}`);
    if (work.skippedTools) actions.push(`not-executed calls: ${work.skippedTools}`);
    lines.push(`  ${work.model}${work.thinking ? ` · ${work.thinking}` : ""} — ${actions.join("; ")}`);
  }
  if (!report.models.length) lines.push("  No executor model response was recorded.");
  const last = report.routes.at(-1);
  if (last) {
    // First request of a session has no previous model; the fallback tier answered without a classified role.
    lines.push(
      last.role ? `  Jewter: ${last.role}/${last.tier ?? "—"}`
        : last.status === "fallback" ? "  Jewter: fallback"
        : "  Jewter: keep",
    );
  }
  if (report.models.some(m => Object.keys(m.tools).some(t => t === "subagent" || t === "subagent_supervisor"))) {
    lines.push("  Child sessions have their own receipts; their work is not attributed to the parent model.");
  }
  return lines;
}
