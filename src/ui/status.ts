import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import type { RoutingRecord } from "../router/state.ts";

export function isChild(ctx: ExtensionContext): boolean {
  const path = ctx.sessionManager.getSessionFile() ?? "";
  return process.env.PI_SUBAGENT_CHILD === "1" || /[/\\]run-\d+[/\\]session\.jsonl$/.test(path);
}

const TIER_NOTES: Record<string, string> = {
  "jev-majority": " · tier: majority",
  "fallback-low-confidence": " · tier: default",
  "fallback-missing": " · tier: default",
};

export function statusText(record: RoutingRecord): string {
  const d = record.decision;
  const confidence = d ? ` · ${Math.round(d.roleConfidence * 100)}%` : "";
  const applied = d && (d.action === "switch" || d.keepReason === "same");
  const tierNote = applied && d.tierSource ? (TIER_NOTES[d.tierSource] ?? "") : "";
  const role = `${record.role ?? "—"}/${record.tier ?? "—"}`;
  // On keep, show what Jev actually answered and why it was not applied.
  const verdict = !applied && record.classifiedRole
    ? ` · Jev said ${record.classifiedRole}${record.classifiedTier ? `/${record.classifiedTier}` : ""} (${record.reason ?? "kept"})`
    : !applied && record.reason ? ` · ${record.reason}` : "";
  return `Jev ${record.status} · ${role} → ${record.model ?? "—"}:${record.thinking ?? "—"}${confidence}${tierNote}${verdict} · ${record.elapsedMs}ms`;
}

export function showStatus(ctx: ExtensionContext, config: JewterConfig, record: RoutingRecord): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("jewter", config.ui.footer ? statusText(record) : undefined);
  if (record.status === "switch" && (config.ui.notify === "all" || (config.ui.notify === "main" && !isChild(ctx)))) {
    ctx.ui.notify(statusText(record), "info");
  } else if (record.reason?.includes("error") || record.reason?.includes("unavailable")) {
    ctx.ui.notify(`Jewter: ${record.reason}`, "warning");
  }
}
