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
 * `auto` prefers TypeSafe when `TYPESAFE_API_KEY` (or `JEWTER_API_KEY`) is
 * present, then OpenRouter. `JEWTER_API_KEY` overrides the selected
 * transport's own credential variable.
 */
export function resolveTransport(jev: JevConfig, env: EnvLike): TransportResolution {
  const overrideKey = env.JEWTER_API_KEY?.trim();
  const pick = (id: "typesafe" | "openrouter"): TransportResolution => {
    const meta = JEV_TRANSPORTS[id];
    const apiKey = overrideKey || env[meta.envKey]?.trim();
    if (!apiKey) {
      return { ok: false, error: `no ${meta.envKey} (or JEWTER_API_KEY) for transport "${id}"` };
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
  if (overrideKey || env.TYPESAFE_API_KEY?.trim()) return pick("typesafe");
  if (env.OPENROUTER_API_KEY?.trim()) return pick("openrouter");
  return { ok: false, error: "no Jev credentials: set TYPESAFE_API_KEY, OPENROUTER_API_KEY, or JEWTER_API_KEY" };
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
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
}

/** Minimal HTTP client for the System One `{model, state, questions}` protocol. */
export class JevClient {
  private readonly transport: ResolvedTransport;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions) {
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
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(this.transport.baseUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.transport.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: this.transport.model, state, questions }),
        signal: combined,
      });
    } catch (error) {
      throw new JevError(
        `Jev request failed (${this.transport.label}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new JevError(`Jev request failed (${response.status}): ${text.slice(0, 200)}`, {
        status: response.status,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new JevError("Jev returned malformed JSON");
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
    return parsed as JevResponse;
  }
}

/** The `auto` transport only exists as a preference; this is its resolved id type. */
export type EffectiveTransportId = Exclude<Transport, "auto">;
