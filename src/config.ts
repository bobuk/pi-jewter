import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Model tiers the router can pick. */
export const TIER_NAMES = ["fast", "medium", "strong"] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** Thinking settings for a tier. `auto` passes through the selected thinking level. */
export const THINKING_SETTINGS = [
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingSetting = (typeof THINKING_SETTINGS)[number];

export const TRANSPORTS = ["auto", "typesafe", "openrouter"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const NOTIFY_MODES = ["main", "all", "off"] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/** A physical model reference plus a thinking setting. */
export interface TierConfig {
  /** `provider/model` reference as shown by Pi's model picker. */
  model?: string;
  thinking?: ThinkingSetting;
}

export interface RoleConfig {
  /** Shown to Jev as the choice description; falls back to the role id. */
  description?: string;
  /** Per-tier overrides; omitted tiers inherit the global tier. */
  tiers?: Partial<Record<TierName, TierConfig>>;
}

export interface JevConfig {
  transport: Transport;
  /** Override the transport's default model slug. */
  model?: string;
  /** Override the transport's default endpoint. */
  baseUrl?: string;
  timeoutMs: number;
  /** Minimum confidence for a role choice to be acted on. */
  minConfidence: number;
  /** Normalized score <= fastMax routes to `fast`. */
  fastMax: number;
  /** Normalized score >= strongMin routes to `strong`. */
  strongMin: number;
  /** With uncertain complexity, a level holding at least this probability still selects its tier. */
  tierMajority: number;
  /** Enable/disable classification; a disabled router keeps the current model. */
  enabled: boolean;
}

export interface RoutingConfig {
  /** Keep the current model for continuation/retry requests of the same turn. */
  sticky: boolean;
  /** Keep the current model when the classified role equals the current one. */
  keepSameRole: boolean;
}

/** How subagent agents bind to Jewter: "auto", "off", or a role id. */
export type SubagentBinding = string;

export interface SubagentsConfig {
  /** Agent name -> "auto" (free routing), "off" (leave as-is), or a role id. */
  agents: Record<string, SubagentBinding>;
}

export interface UiConfig {
  notify: NotifyMode;
  footer: boolean;
  cards: boolean;
  /** Show a model/action receipt when a request fully finishes, independent of routing cards. */
  report: boolean;
}

export interface CompactionConfig {
  enabled: boolean;
  /** Missing means use the global fast tier. */
  model?: string;
  thinking: ThinkingSetting;
  minConfidence: number;
  minReduction: number;
  minResultChars: number;
  retainedChars: number;
  maxCandidates: number;
  /** Largest summary Jewter may produce; above it Pi's summarizer takes over. */
  maxSummaryChars: number;
  timeoutMs: number;
}

export interface JewterConfig {
  enabled: boolean;
  compaction: CompactionConfig;
  tiers: Record<TierName, TierConfig>;
  roles: Record<string, RoleConfig>;
  jev: JevConfig;
  routing: RoutingConfig;
  subagents: SubagentsConfig;
  ui: UiConfig;
}

export interface ConfigPaths {
  global: string;
  project: string;
}

export interface LoadedConfig {
  config: JewterConfig;
  paths: ConfigPaths;
  warnings: string[];
  /** Paths that actually contributed values, in merge order. */
  sources: string[];
}

/** Default role descriptions shipped with the extension. */
export const DEFAULT_ROLES: Record<string, RoleConfig> = {
  planning: {
    description: "Planning, design, and architecture decisions before implementation",
  },
  implementation: {
    description: "Writing, changing, or fixing code toward a known goal; quick build-and-iterate loops",
  },
  verification: {
    description: "Checking that existing work is correct: running or writing tests, reproducing bugs, probing edge cases, validating a fix before it ships",
    // Thoroughness matters more than capability here: keep the tier models, raise the effort.
    tiers: { fast: { thinking: "medium" }, medium: { thinking: "high" }, strong: { thinking: "high" } },
  },
  review: {
    description: "Reviewing code, plans, or diffs; finding problems, risks, and regressions",
  },
  research: {
    description: "Research, exploration, and information gathering across sources",
  },
  quick: {
    description: "Small questions, quick lookups, and simple mechanical edits",
  },
};

export function isTierName(value: unknown): value is TierName {
  return typeof value === "string" && (TIER_NAMES as readonly string[]).includes(value);
}

export function isRoleId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value);
}

/** Global config lives in Pi's agent directory, honoring `PI_CODING_AGENT_DIR`. */
export function configPaths(cwd: string, agentDir: string = getAgentDir()): ConfigPaths {
  return {
    global: join(agentDir, "jewter.json"),
    project: join(cwd, ".pi", "jewter.json"),
  };
}

export function defaultConfig(): JewterConfig {
  return {
    enabled: true,
    compaction: { enabled: false, thinking: "off", minConfidence: 0.8, minReduction: 0.15, minResultChars: 1200, retainedChars: 400, maxCandidates: 40, maxSummaryChars: 60000, timeoutMs: 15000 },
    tiers: {
      fast: { thinking: "auto" },
      medium: { thinking: "auto" },
      strong: { thinking: "auto" },
    },
    roles: structuredClone(DEFAULT_ROLES),
    jev: {
      transport: "auto",
      timeoutMs: 8000,
      minConfidence: 0.6,
      fastMax: 0.34,
      strongMin: 0.67,
      tierMajority: 0.5,
      enabled: true,
    },
    routing: {
      sticky: true,
      keepSameRole: true,
    },
    subagents: {
      agents: {},
    },
    ui: {
      notify: "main",
      footer: true,
      cards: true,
      report: true,
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge plain objects; later scalars win, arrays and null replace. */
export function mergeConfig<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (patch === null || !isPlainObject(base) || !isPlainObject(patch)) return patch as T;
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = key in result ? mergeConfig((base as Record<string, unknown>)[key], value) : value;
  }
  return result as T;
}

function readJsonFile(path: string, warnings: string[]): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    warnings.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "off"].includes(lowered)) return false;
  }
  return fallback;
}

function normalizeTier(raw: unknown, fallback: TierConfig): TierConfig {
  if (!isPlainObject(raw)) return fallback;
  const next: TierConfig = { ...fallback };
  const model = asString(raw.model);
  if (model) next.model = model;
  else if (raw.model === null || raw.model === "") delete next.model;
  const thinking = raw.thinking;
  if (thinking === null || thinking === "") delete next.thinking;
  else if (typeof thinking === "string" && (THINKING_SETTINGS as readonly string[]).includes(thinking)) {
    next.thinking = thinking as ThinkingSetting;
  }
  return next;
}

function normalizeRole(raw: unknown, fallback: RoleConfig | undefined): RoleConfig | undefined {
  if (!isPlainObject(raw)) return fallback;
  const next: RoleConfig = { ...(fallback ?? {}) };
  const description = asString(raw.description);
  if (description) next.description = description;
  if (isPlainObject(raw.tiers)) {
    const tiers: Partial<Record<TierName, TierConfig>> = { ...next.tiers };
    for (const tier of TIER_NAMES) {
      if (tier in raw.tiers) tiers[tier] = normalizeTier(raw.tiers[tier], {});
    }
    next.tiers = tiers;
  }
  return next;
}

export interface NormalizeResult {
  config: JewterConfig;
  warnings: string[];
}

/** Normalize an arbitrary parsed object into a complete config. */
export function normalizeConfig(raw: unknown, base: JewterConfig = defaultConfig()): NormalizeResult {
  const warnings: string[] = [];
  const config = structuredClone(base);
  if (!isPlainObject(raw)) return { config, warnings };

  if ("enabled" in raw) config.enabled = asBoolean(raw.enabled, config.enabled);
  if (isPlainObject(raw.compaction)) {
    const c = raw.compaction;
    config.compaction.enabled = asBoolean(c.enabled, config.compaction.enabled);
    if (asString(c.model)) config.compaction.model = asString(c.model);
    else if (c.model === null || c.model === "") delete config.compaction.model;
    if (typeof c.thinking === "string" && (THINKING_SETTINGS as readonly string[]).includes(c.thinking)) config.compaction.thinking = c.thinking as ThinkingSetting;
    config.compaction.minConfidence = clampNumber(asNumber(c.minConfidence, config.compaction.minConfidence), 0.5, 1);
    config.compaction.minReduction = clampNumber(asNumber(c.minReduction, config.compaction.minReduction), 0, 1);
    config.compaction.minResultChars = Math.round(clampNumber(asNumber(c.minResultChars, config.compaction.minResultChars), 400, 100000));
    config.compaction.retainedChars = Math.round(clampNumber(asNumber(c.retainedChars, config.compaction.retainedChars), 100, 10000));
    config.compaction.maxCandidates = Math.round(clampNumber(asNumber(c.maxCandidates, config.compaction.maxCandidates), 1, 100));
    config.compaction.maxSummaryChars = Math.round(clampNumber(asNumber(c.maxSummaryChars, config.compaction.maxSummaryChars), 4000, 1000000));
    config.compaction.timeoutMs = Math.round(clampNumber(asNumber(c.timeoutMs, config.compaction.timeoutMs), 500, 120000));
  }

  if (isPlainObject(raw.tiers)) {
    for (const tier of TIER_NAMES) {
      if (tier in raw.tiers) config.tiers[tier] = normalizeTier(raw.tiers[tier], config.tiers[tier]);
    }
  }

  if (isPlainObject(raw.roles)) {
    for (const [id, role] of Object.entries(raw.roles)) {
      if (!isRoleId(id)) {
        warnings.push(`role "${id}" ignored: ids must match [a-z][a-z0-9-]*`);
        continue;
      }
      if (role === null) { delete config.roles[id]; continue; }
      const normalized = normalizeRole(role, config.roles[id]);
      if (normalized) config.roles[id] = normalized;
    }
  }

  if (isPlainObject(raw.jev)) {
    const jev = raw.jev;
    if (typeof jev.transport === "string" && (TRANSPORTS as readonly string[]).includes(jev.transport)) {
      config.jev.transport = jev.transport as Transport;
    }
    const model = asString(jev.model);
    if (model) config.jev.model = model;
    const baseUrl = asString(jev.baseUrl);
    if (baseUrl) config.jev.baseUrl = baseUrl;
    config.jev.timeoutMs = clampNumber(asNumber(jev.timeoutMs, config.jev.timeoutMs), 500, 120_000);
    config.jev.minConfidence = clampNumber(asNumber(jev.minConfidence, config.jev.minConfidence), 0, 1);
    config.jev.fastMax = clampNumber(asNumber(jev.fastMax, config.jev.fastMax), 0, 1);
    config.jev.strongMin = clampNumber(asNumber(jev.strongMin, config.jev.strongMin), 0, 1);
    if (config.jev.fastMax > config.jev.strongMin) {
      warnings.push(
        `jev.fastMax (${config.jev.fastMax}) is greater than jev.strongMin (${config.jev.strongMin}); clamped`,
      );
      config.jev.fastMax = Math.min(config.jev.fastMax, config.jev.strongMin);
    }
    config.jev.tierMajority = clampNumber(asNumber(jev.tierMajority, config.jev.tierMajority), 0.34, 1);
    config.jev.enabled = asBoolean(jev.enabled, config.jev.enabled);
  }

  if (isPlainObject(raw.routing)) {
    const routing = raw.routing;
    config.routing.sticky = asBoolean(routing.sticky, config.routing.sticky);
    config.routing.keepSameRole = asBoolean(routing.keepSameRole, config.routing.keepSameRole);
  }

  if (isPlainObject(raw.subagents) && isPlainObject(raw.subagents.agents)) {
    for (const [agent, binding] of Object.entries(raw.subagents.agents)) {
      const value = asString(binding);
      if (value) config.subagents.agents[agent] = value;
      else if (binding === null) delete config.subagents.agents[agent];
    }
  }

  if (isPlainObject(raw.ui)) {
    const ui = raw.ui;
    if (typeof ui.notify === "string" && (NOTIFY_MODES as readonly string[]).includes(ui.notify)) {
      config.ui.notify = ui.notify as NotifyMode;
    }
    config.ui.footer = asBoolean(ui.footer, config.ui.footer);
    config.ui.cards = asBoolean(ui.cards, config.ui.cards);
    config.ui.report = asBoolean(ui.report, config.ui.report);
  }

  return { config, warnings };
}

export interface EnvLike {
  [key: string]: string | undefined;
}

/** Apply `JEWTER_*` environment overrides on top of file config. */
export function applyEnv(config: JewterConfig, env: EnvLike): JewterConfig {
  const next = structuredClone(config);
  if (env.JEWTER_DISABLED !== undefined) next.enabled = !asBoolean(env.JEWTER_DISABLED, false);
  if (env.JEWTER_TRANSPORT && (TRANSPORTS as readonly string[]).includes(env.JEWTER_TRANSPORT)) {
    next.jev.transport = env.JEWTER_TRANSPORT as Transport;
  }
  if (env.JEWTER_JEV_MODEL) next.jev.model = env.JEWTER_JEV_MODEL;
  if (env.JEWTER_JEV_BASE_URL) next.jev.baseUrl = env.JEWTER_JEV_BASE_URL;
  if (env.JEWTER_NOTIFY && (NOTIFY_MODES as readonly string[]).includes(env.JEWTER_NOTIFY)) {
    next.ui.notify = env.JEWTER_NOTIFY as NotifyMode;
  }
  return next;
}

/** Read global and project config files, merge, then apply env overrides. */
export function loadConfig(options: {
  cwd: string;
  env?: EnvLike;
  /** Override Pi's agent directory (tests); defaults to `getAgentDir()`. */
  agentDir?: string;
  globalPath?: string;
  projectPath?: string;
  projectTrusted?: boolean;
}): LoadedConfig {
  const defaults = configPaths(options.cwd, options.agentDir);
  const paths: ConfigPaths = {
    global: options.globalPath ?? defaults.global,
    project: options.projectPath ?? defaults.project,
  };
  const warnings: string[] = [];
  const sources: string[] = [];
  let merged: JewterConfig = defaultConfig();

  for (const path of options.projectTrusted === false ? [paths.global] : [paths.global, paths.project]) {
    const raw = readJsonFile(path, warnings);
    if (raw === undefined) continue;
    sources.push(path);
    merged = mergeConfig(merged, raw) as JewterConfig;
  }

  const normalized = normalizeConfig(merged, defaultConfig());
  warnings.push(...normalized.warnings);
  const config = applyEnv(normalized.config, options.env ?? process.env);
  return { config, paths, warnings, sources };
}

export interface EffectiveTier extends TierConfig {
  model?: string;
  thinking: ThinkingSetting;
}

/** Resolve a role tier, falling back to the global tier. */export function resolveTier(config: JewterConfig, roleId: string, tier: TierName): EffectiveTier {
  const global = config.tiers[tier] ?? {};
  const role = config.roles[roleId]?.tiers?.[tier];
  const model = role?.model ?? global.model;
  const thinking = role?.thinking ?? global.thinking ?? "auto";
  return model ? { model, thinking } : { thinking };
}

/** Resolve the subagent binding for an agent name. Default: `off`. */
export function resolveSubagentBinding(
  config: JewterConfig,
  agentName: string,
): { mode: "off" } | { mode: "auto" } | { mode: "role"; role: string } {
  const binding = config.subagents.agents[agentName];
  if (!binding || binding === "off") return { mode: "off" };
  if (binding === "auto") return { mode: "auto" };
  if (isRoleId(binding) && config.roles[binding]) return { mode: "role", role: binding };
  return { mode: "off" };
}

/** Physical model references already used anywhere in the config. */
export function configuredModelRefs(config: JewterConfig): string[] {
  const refs = new Set<string>();
  for (const tier of Object.values(config.tiers)) if (tier.model) refs.add(tier.model);
  for (const role of Object.values(config.roles)) {
    for (const tier of Object.values(role.tiers ?? {})) if (tier?.model) refs.add(tier.model);
  }
  if (config.compaction.model) refs.add(config.compaction.model);
  return [...refs];
}

/**
 * Role ids named in the project config file, without trusting its contents.
 * Used only to register virtual model names before Pi resolves `--model`;
 * routing still reads project settings only when the project is trusted.
 */
export function projectRoleIds(cwd: string, limit = 20): string[] {
  const raw = readJsonFile(configPaths(cwd).project, []);
  if (!isPlainObject(raw) || !isPlainObject(raw.roles)) return [];
  return Object.entries(raw.roles)
    .filter(([id, role]) => isRoleId(id) && role !== null)
    .map(([id]) => id)
    .slice(0, limit);
}
