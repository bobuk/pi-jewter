import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Update only the model field; off leaves existing settings untouched. */
export function setAgentOverride(settings: Record<string, unknown>, agent: string, model: string | null, extension?: string): Record<string, unknown> {
  if (!/^[\w.-]+$/.test(agent)) throw new Error("Invalid agent name");
  if (model === null) return settings;
  const subagents = { ...object(settings.subagents) };
  const overrides = { ...object(subagents.agentOverrides) };
  const existing = object(overrides[agent]);
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
  if (model === null) return;
  const settings = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> : {};
  const next = setAgentOverride(settings, agent, model, extension);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}
