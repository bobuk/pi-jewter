import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import type { RoutingRecord } from "../router/state.ts";
import { showStatus, statusText } from "./status.ts";

export const ENTRY = "jewter-decision";

export function registerRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer(ENTRY, (entry, { expanded }, theme) => {
    const record = entry.data as RoutingRecord;
    const detail = [record.transport && `transport: ${record.transport}`, record.reason && `reason: ${record.reason}`,
      record.decision && `score: ${record.decision.score.toFixed(2)} confidence: ${record.decision.scoreConfidence.toFixed(2)} tier source: ${record.decision.tierSource ?? "unknown"} probabilities: ${JSON.stringify(record.decision.probabilities)}`].filter(Boolean).join("\n");
    return new Text(theme.fg("accent", statusText(record)) + (expanded && detail ? `\n${theme.fg("dim", detail)}` : ""), 0, 0);
  });
}

export function recordDecision(pi: ExtensionAPI, ctx: ExtensionContext, config: JewterConfig, record: RoutingRecord): void {
  // Persist even in print/JSON mode for inspection on resume; cards can be disabled.
  if (config.ui.cards) pi.appendEntry(ENTRY, record);
  showStatus(ctx, config, record);
}
