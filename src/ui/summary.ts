import { resolveTier, TIER_NAMES, type JewterConfig, type TierName } from "../config.ts";

/** Short display name of a `provider/model` reference: the last path segment. */
export function shortModel(ref: string | undefined): string {
  if (!ref) return "—";
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/** `luna · sol · flash` for the default tiers. */
export function defaultTiersSummary(config: JewterConfig): string {
  return TIER_NAMES.map(tier => shortModel(config.tiers[tier]?.model)).join(" · ");
}

/** Per-tier models of a role; inherited models are shown in parentheses, own thinking as `:level`. */
export function roleTiersSummary(config: JewterConfig, role: string): string {
  const own = config.roles[role]?.tiers ?? {};
  if (!TIER_NAMES.some(tier => own[tier]?.model || own[tier]?.thinking)) return "(inherits)";
  return TIER_NAMES.map(tier => {
    const model = shortModel(resolveTier(config, role, tier as TierName).model);
    const thinking = own[tier]?.thinking ? `:${own[tier]!.thinking}` : "";
    return (own[tier]?.model ? model : `(${model})`) + thinking;
  }).join(" · ");
}

/** Root row: `fast luna · medium sol · strong flash · 5 roles`. */
export function modelsSummary(config: JewterConfig): string {
  const tiers = TIER_NAMES.map(tier => `${tier} ${shortModel(config.tiers[tier]?.model)}`).join(" · ");
  const roles = Object.keys(config.roles).length;
  return `${tiers} · ${roles} role${roles === 1 ? "" : "s"}`;
}

export function compactionSummary(config: JewterConfig): string {
  if (!config.compaction.enabled) return "off";
  return `on · ${shortModel(config.compaction.model ?? config.tiers.fast.model)}`;
}

export function displaySummary(config: JewterConfig): string {
  return `notify ${config.ui.notify} · report ${config.ui.report ? "on" : "off"}`;
}

export function advancedSummary(config: JewterConfig): string {
  const routing = config.enabled ? "" : "routing off · ";
  return `${routing}Jev ${config.jev.transport} · confidence ${config.jev.minConfidence}`;
}

export const onOff = (value: boolean): string => (value ? "on" : "off");

/** Jewter bindings among subagent overrides: agent name -> `jewter/<id>` id. */
export function subagentBindings(settings: unknown): Record<string, string> {
  const overrides = (settings as { subagents?: { agentOverrides?: Record<string, { model?: unknown }> } })?.subagents?.agentOverrides ?? {};
  const bound: Record<string, string> = {};
  for (const [agent, override] of Object.entries(overrides)) {
    const model = override?.model;
    if (typeof model === "string" && model.startsWith("jewter/")) bound[agent] = model.slice("jewter/".length);
  }
  return bound;
}
