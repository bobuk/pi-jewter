import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// No tokenizer is available for Jev. UTF-8 bytes (including JSON escaping) are
// a conservative estimate, not an exact token count. Leave room for service
// framing and output; unknown Jev models use the same deliberately small cap.
export const JEV_REQUEST_BYTES = 24_000;
export const CONTEXT_ENTRY = "jewter-service-context";
export class ContextError extends Error {
  readonly kind: "fixed-overhead" | "provider-overflow";
  constructor(kind: "fixed-overhead" | "provider-overflow") {
    super(`Service context refused: ${kind}`);
    this.name = "ContextError";
    this.kind = kind;
  }
}

export function isContextError(error: unknown): boolean {
  if (error instanceof ContextError) return true;
  const parts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") { parts.push(value); return; }
    if (!value || typeof value !== "object" || depth === 0) return;
    const object = value as Record<string, unknown>;
    for (const key of ["message", "errorMessage", "code", "type", "error", "cause"]) visit(object[key], depth - 1);
  };
  visit(error, 4);
  const text = parts.join(" ");
  return /context[_ -]?(length|window|limit|overflow)|maximum context|too many (input )?tokens|prompt (is )?too long|request (is )?too large|maximum number of tokens|reduce.{0,40}length.{0,30}messages|input.{0,40}(too long|token limit)|exceed.{0,60}(context|token)|token.{0,40}(exceed|limit)/i.test(text);
}

export interface ContextDiagnostic {
  service: "jev" | "llm";
  purpose: "routing" | "verification" | "compaction";
  event: "reduced" | "fixed-overhead" | "provider-overflow";
}

/** A small, allowlisted local entry. No arbitrary strings or provider errors. */
export function contextRecorder(pi: ExtensionAPI, purpose: ContextDiagnostic["purpose"]) {
  return (service: ContextDiagnostic["service"], event: ContextDiagnostic["event"]) => {
    try { pi.appendEntry(CONTEXT_ENTRY, { version: 1, service, purpose, event }); } catch { /* Diagnostics must not change routing. */ }
  };
}

const viewKeys = new Set(["prompt", "previous_exchange", "step_context", "currentGoal", "recentContext", "previousSummary", "history", "excerpt", "final_response", "finalText", "request", "final_message"]);
function reduceViews(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) return value.map(item => reduceViews(item, limit));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  let incomplete = false;
  for (const [key, item] of Object.entries(value)) {
    if (viewKeys.has(key) && typeof item === "string" && item.length > limit) {
      const head = Math.floor(limit / 2);
      result[key] = `${item.slice(0, head)}\n[view omitted]\n${head ? item.slice(-head) : ""}`;
      incomplete = true;
    } else result[key] = reduceViews(item, limit);
  }
  if (incomplete && "complete" in result) result.complete = false;
  return result;
}

/** Reduce only explicit evidence fields. All questions, IDs and schemas stay intact. */
export function fitViews<T>(state: T, serialize: (view: T) => string, budget: number): { state: T; body: string; reduced: boolean } {
  const body = serialize(state);
  if (Buffer.byteLength(body, "utf8") <= budget) return { state, body, reduced: false };
  // At most 18 local fits. No network retry. Limit zero still carries an omission marker.
  for (let limit = 32768; ; limit = Math.floor(limit / 2)) {
    const view = reduceViews(state, limit) as T;
    const fitted = serialize(view);
    if (Buffer.byteLength(fitted, "utf8") <= budget) return { state: view, body: fitted, reduced: true };
    if (limit === 0) throw new ContextError("fixed-overhead");
  }
}
