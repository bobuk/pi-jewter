import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const JEWTER_EXT_RE = /(?:^|[/\\])pi-jewter[/\\]src[/\\]index\.ts$/;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isJewterExtension(entry: unknown, extension?: string): boolean {
  return typeof entry === "string" && (entry === extension || JEWTER_EXT_RE.test(entry));
}

/** Set or remove (`model === null`) a Jewter model override while preserving unrelated agent settings. */
export function setAgentOverride(settings: Record<string, unknown>, agent: string, model: string | null, extension?: string): Record<string, unknown> {
  if (!/^[\w.-]+$/.test(agent)) throw new Error("Invalid agent name");
  const rawSubagents = object(settings.subagents);
  const rawOverrides = object(rawSubagents.agentOverrides);
  const rawExisting = rawOverrides[agent];

  if (model === null) {
    if (!rawExisting || typeof rawExisting !== "object" || Array.isArray(rawExisting)) return settings;
    const record = rawExisting as Record<string, unknown>;
    const hasJewterModel = typeof record.model === "string" && record.model.startsWith("jewter/");
    const priorExt = record.subagentOnlyExtensions;
    const hasJewterExt = Array.isArray(priorExt) && priorExt.some(e => isJewterExtension(e, extension));
    if (!hasJewterModel && !hasJewterExt) return settings;

    const nextAgent: Record<string, unknown> = { ...record };
    if (hasJewterModel) delete nextAgent.model;
    if (Array.isArray(priorExt)) {
      const remaining = priorExt.filter(e => !isJewterExtension(e, extension));
      if (remaining.length > 0) nextAgent.subagentOnlyExtensions = remaining;
      else delete nextAgent.subagentOnlyExtensions;
    }

    const overrides = { ...rawOverrides };
    if (Object.keys(nextAgent).length > 0) overrides[agent] = nextAgent;
    else delete overrides[agent];

    const subagents = { ...rawSubagents };
    if (Object.keys(overrides).length > 0) subagents.agentOverrides = overrides;
    else delete subagents.agentOverrides;

    const nextSettings = { ...settings };
    if (Object.keys(subagents).length > 0) nextSettings.subagents = subagents;
    else delete nextSettings.subagents;
    return nextSettings;
  }

  const subagents = { ...rawSubagents };
  const overrides = { ...rawOverrides };
  const existing = object(rawExisting);
  const next = { ...existing, model } as Record<string, unknown>;
  if (extension) {
    const prior = existing.subagentOnlyExtensions;
    if (prior !== undefined && prior !== false && !Array.isArray(prior)) throw new Error("Invalid existing subagentOnlyExtensions");
    next.subagentOnlyExtensions = [...new Set([...(Array.isArray(prior) ? prior as string[] : []), extension])];
  }
  overrides[agent] = next;
  subagents.agentOverrides = overrides;
  return { ...settings, subagents };
}

export function writeAgentOverride(path: string, agent: string, model: string | null, extension?: string): void {
  if (model === null && !existsSync(path)) return;
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path}: expected a JSON object`);
    }
    settings = parsed as Record<string, unknown>;
  }
  const next = setAgentOverride(settings, agent, model, extension);
  if (next === settings) return;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* Temp file may not exist or may already be moved. */ }
    throw error;
  }
}
