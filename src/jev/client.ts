import { ContextError, fitViews, isContextError, JEV_REQUEST_BYTES, type ContextDiagnostic } from "../service/context.ts";
import type { EnvLike, JevConfig, Transport } from "../config.ts";
import { JEV_TRANSPORTS, type JevQuestions, type JevResponse } from "./types.ts";

/** A transport ready to be used: credential, endpoint and model resolved. */
export interface ResolvedTransport {
  id: "typesafe" | "openrouter";
  label: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type TransportResolution = { ok: true; transport: ResolvedTransport } | { ok: false; error: string };

/**
 * Resolve the effective Jev transport.
 *
 * `auto` prefers TypeSafe when an environment or manually configured key is
 * present, then OpenRouter. Environment credentials override the saved key;
 * `JEWTER_API_KEY` overrides the selected transport's own credential variable.
 */
export function resolveTransport(jev: JevConfig, env: EnvLike): TransportResolution {
  const overrideKey = env.JEWTER_API_KEY?.trim();
  const typesafeKey = env.TYPESAFE_API_KEY?.trim() || jev.typesafeApiKey?.trim();
  const pick = (id: "typesafe" | "openrouter"): TransportResolution => {
    const meta = JEV_TRANSPORTS[id];
    const apiKey = overrideKey || (id === "typesafe" ? typesafeKey : env[meta.envKey]?.trim());
    if (!apiKey) {
      return { ok: false, error: `no ${meta.envKey} (or JEWTER_API_KEY${id === "typesafe" ? " or saved TypeSafe key" : ""}) for transport "${id}"` };
    }
    return {
      ok: true,
      transport: {
        id,
        label: meta.label,
        apiKey,
        baseUrl: jev.baseUrl?.trim() || meta.defaultBaseUrl,
        model: jev.model?.trim() || meta.defaultModel,
      },
    };
  };

  if (jev.transport === "typesafe") return pick("typesafe");
  if (jev.transport === "openrouter") return pick("openrouter");
  if (overrideKey || typesafeKey) return pick("typesafe");
  if (env.OPENROUTER_API_KEY?.trim()) return pick("openrouter");
  return { ok: false, error: "no Jev credentials: enter a TypeSafe API key in /jewter → Advanced, or set TYPESAFE_API_KEY, OPENROUTER_API_KEY, or JEWTER_API_KEY" };
}

export class JevError extends Error {
  readonly status?: number;
  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "JevError";
    this.status = options?.status;
  }
}

export interface JevClientOptions {
  transport: ResolvedTransport;
  timeoutMs: number;
  diagnostic?: (service: ContextDiagnostic["service"], event: ContextDiagnostic["event"]) => void;
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
}

/** Minimal HTTP client for the System One `{model, state, questions}` protocol. */
export class JevClient {
  private readonly diagnostic: JevClientOptions["diagnostic"];
  private readonly transport: ResolvedTransport;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions) {
    this.diagnostic = options.diagnostic;
    this.transport = options.transport;
    this.timeoutMs = options.timeoutMs;
    this.fetcher = options.fetch ?? fetch;
  }

  get transportId(): "typesafe" | "openrouter" {
    return this.transport.id;
  }

  async ask(
    state: unknown,
    questions: JevQuestions,
    signal?: AbortSignal,
  ): Promise<JevResponse> {
    signal?.throwIfAborted();
    let fitted;
    try {
      fitted = fitViews(state, view => JSON.stringify({ model: this.transport.model, state: view, questions }), JEV_REQUEST_BYTES);
    } catch (error) {
      if (isContextError(error)) this.diagnostic?.("jev", "fixed-overhead");
      throw error;
    }
    if (fitted.reduced) this.diagnostic?.("jev", "reduced");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.fetcher(this.transport.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.transport.apiKey}`,
          "content-type": "application/json",
        },
        body: fitted.body,
        signal: combined,
      });
      combined.throwIfAborted();
      const text = await response.text();
      combined.throwIfAborted();
      if (response.status === 413 || (!response.ok && isContextError(text))) {
        throw new ContextError("provider-overflow");
      }
      if (!response.ok) {
        throw new JevError(`Jev request failed (${response.status}): provider error`, {
          status: response.status,
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new JevError("Jev returned malformed JSON");
      }
      if (parsed && typeof parsed === "object" && "error" in parsed && isContextError(parsed.error)) {
        throw new ContextError("provider-overflow");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !("answers" in parsed) ||
        parsed.answers === null ||
        typeof parsed.answers !== "object"
      ) {
        throw new JevError("Jev response is missing answers");
      }
      return { ...parsed as JevResponse, contextReduced: fitted.reduced };
    } catch (error) {
      // Cancellation wins over provider classification, including late body failures.
      combined.throwIfAborted();
      if (isContextError(error)) {
        this.diagnostic?.("jev", "provider-overflow");
        throw new ContextError("provider-overflow");
      }
      if (error instanceof JevError) throw error;
      throw new JevError(`Jev request failed (${this.transport.label}): network or timeout error`);
    }
  }
}

/** The `auto` transport only exists as a preference; this is its resolved id type. */
export type EffectiveTransportId = Exclude<Transport, "auto">;
