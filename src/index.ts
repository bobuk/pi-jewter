import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defaultConfig, loadConfig, projectRoleIds } from "./config.ts";
import { registerRouters } from "./router/virtual.ts";
import { recordDecision, registerRenderer } from "./ui/decision-entry.ts";
import { registerCommands } from "./commands/jewter.ts";
import { showStatus } from "./ui/status.ts";
import type { RoutingRecord } from "./router/state.ts";
import { registerCompaction } from "./compaction/extension.ts";
import { registerReport } from "./report/extension.ts";
import { registerVerify } from "./verify/extension.ts";
import { registerPsst } from "./commands/psst.ts";

export default function (pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  const getConfig = (ctx: ExtensionContext) => loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }).config;
  registerRenderer(pi);
  const report = registerReport(pi, getConfig);
  registerCompaction(pi, getConfig, call => report.service(call));
  const verify = registerVerify(pi, getConfig);
  const register = registerRouters(pi, {
    getContext: () => context,
    getConfig,
    observe: (record, ctx) => {
      report.route(record);
      verify.route(record);
      recordDecision(pi, ctx, getConfig(ctx), record);
    },
  });
  // Register before model resolution so `--model jewter/<project-role>` resolves. Project role
  // names are registered early; their settings are applied only once the project is trusted,
  // and session_start drops them again when it is not.
  register(loadConfig({ cwd: process.cwd(), projectTrusted: false }).config ?? defaultConfig(), projectRoleIds(process.cwd()));
  let shownWarnings = "";
  const refresh = (ctx: ExtensionContext) => {
    context = ctx;
    const loaded = loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
    register(loaded.config);
    // Surface broken settings once instead of silently running on defaults.
    const text = loaded.warnings.join("\n");
    if (text && text !== shownWarnings && ctx.hasUI) ctx.ui.notify(`Jewter config: ${text}`, "warning");
    shownWarnings = text;
  };
  registerCommands(pi, refresh);
  registerPsst(pi, getConfig);
  pi.on("session_start", async (_event, ctx) => { refresh(ctx); });
  pi.on("session_tree", async (_event, ctx) => {
    context = ctx;
    const last = ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === "jewter-decision").at(-1);
    if (last && last.type === "custom") showStatus(ctx, getConfig(ctx), last.data as RoutingRecord);
    else if (ctx.hasUI) ctx.ui.setStatus("jewter", undefined);
  });
}
