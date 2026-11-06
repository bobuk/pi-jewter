import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { JewterConfig } from "../config.ts";
import { RequestReport, reportLines, type ModelReport } from "./summary.ts";

export const REPORT_ENTRY = "jewter-model-report";

/** A visible, persisted receipt; not a model message and never triggers another turn. */
export function registerReport(pi: ExtensionAPI, getConfig: (ctx: ExtensionContext) => JewterConfig): RequestReport {
  const report = new RequestReport();
  pi.registerEntryRenderer(REPORT_ENTRY, (entry, _options, theme) => {
    const lines = reportLines(entry.data as ModelReport);
    return new Text([theme.bold(theme.fg("accent", lines[0] ?? "Models")), ...lines.slice(1)].join("\n"), 0, 0);
  });
  pi.on("before_agent_start", async () => { report.start(); });
  // Automatic compaction may run during startup, before before_agent_start.
  pi.on("session_before_compact", async event => {
    if (event.reason !== "manual") report.start();
  });
  // message_end carries the physical provider/model even when ctx.model is a virtual router.
  pi.on("message_end", async event => {
    if (event.message.role === "assistant") report.assistant(event.message);
  });
  pi.on("tool_execution_start", async event => { report.toolStart(event); });
  pi.on("tool_execution_end", async event => { report.toolEnd(event); });
  // agent_end can precede retries/compaction; only settled is the final boundary.
  pi.on("agent_settled", async (event, ctx) => {
    const result = report.finish(event.aborted);
    if (result && getConfig(ctx).ui.report) pi.appendEntry(REPORT_ENTRY, result);
  });
  pi.on("session_start", async () => { report.reset(); });
  pi.on("session_shutdown", async () => { report.reset(); });
  pi.on("session_tree", async () => { report.reset(); });
  return report;
}
