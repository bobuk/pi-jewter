import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { configPaths, loadConfig, type EnvLike } from "../config.ts";
import { classify } from "../router/virtual.ts";
import { decide } from "../jev/decide.ts";
import { ENTRY } from "../ui/decision-entry.ts";
import { menu, patchFile } from "../ui/menu.ts";
import { setupDialogPrompt } from "./dialog.ts";
import { statusText } from "../ui/status.ts";
import type { RoutingRecord } from "../router/state.ts";
import { VERIFY_ENTRY, type VerifyEntry } from "../verify/extension.ts";

export interface ToggleOutcome {
  level: "info" | "warning";
  message: string;
}

export function toggleRouting(
  wanted: boolean,
  options: { cwd: string; projectTrusted: boolean; scope?: "global" | "project"; agentDir?: string; env?: EnvLike },
): ToggleOutcome {
  const scope = options.scope ?? "global";
  const label = wanted ? "on" : "off";
  if (scope === "project" && !options.projectTrusted) {
    return { level: "warning", message: "Jewter: project is not trusted; project settings are unavailable" };
  }
  const paths = configPaths(options.cwd, options.agentDir);
  patchFile(paths[scope], d => { d.enabled = wanted; });
  const env = options.env ?? process.env;
  const effective = loadConfig({
    cwd: options.cwd,
    agentDir: options.agentDir,
    env,
    projectTrusted: options.projectTrusted,
  }).config;
  if (effective.enabled !== wanted) {
    const fileOnly = loadConfig({
      cwd: options.cwd,
      agentDir: options.agentDir,
      env: {},
      projectTrusted: options.projectTrusted,
    }).config;
    const reason = fileOnly.enabled === wanted
      ? "JEWTER_DISABLED environment variable"
      : `.pi/jewter.json (use /jewter ${label} project to change project config)`;
    return {
      level: "warning",
      message: `Jewter ${scope} config set to ${label}, but routing remains ${effective.enabled ? "on" : "off"} (overridden by ${reason})`,
    };
  }
  if (wanted && !effective.jev.enabled) {
    return {
      level: "warning",
      message: `Jewter ${scope === "project" ? "project " : ""}on, but Jev classification is disabled (jev.enabled is false)`,
    };
  }
  return { level: "info", message: scope === "project" ? `Jewter ${label} (project)` : `Jewter ${label}` };
}

const USAGE = "Usage: /jewter [menu|status|why|log [n]|route <text>|verify|on [global|project]|off [global|project]]";

export function registerCommands(pi: ExtensionAPI, refresh: (ctx: ExtensionCommandContext) => void): void {
  pi.registerCommand("jewter", { description: "Configure and inspect Jev model routing", handler: async (args, ctx) => {
    const [first, ...rest] = args.trim().split(/\s+/);
    const command = first || "menu";
    const records = () => ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === ENTRY).map(e => (e as { data: RoutingRecord }).data);
    if (command === "menu") {
      const result = await menu(ctx, () => refresh(ctx));
      // The menu closed before the dialog turn starts.
      if (result === "dialog") await pi.sendUserMessage(setupDialogPrompt(ctx.cwd));
      return;
    }
    if (command === "on" || command === "off") {
      const rawScope = rest[0];
      if (rest.length > 1 || (rawScope !== undefined && rawScope !== "global" && rawScope !== "project")) {
        ctx.ui.notify(USAGE, "warning");
        return;
      }
      try {
        const outcome = toggleRouting(command === "on", {
          cwd: ctx.cwd,
          projectTrusted: ctx.isProjectTrusted(),
          scope: rawScope,
        });
        refresh(ctx);
        ctx.ui.notify(outcome.message, outcome.level);
      } catch (e) {
        ctx.ui.notify(`Jewter: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return;
    }
    if (command === "status" || command === "why" || command === "log") {
      const all = records();
      const count = command === "log" ? Math.min(50, Math.max(1, Number(rest[0]) || 10)) : 1;
      const selected = all.slice(-count);
      ctx.ui.notify(selected.length ? selected.map(r => command === "status" ? statusText(r) : JSON.stringify(r, null, 2)).join("\n") : "Jewter: no decisions on this branch", "info"); return;
    }
    if (command === "verify") {
      const last = ctx.sessionManager.getBranch().filter(e => e.type === "custom" && e.customType === VERIFY_ENTRY).at(-1);
      if (!last || last.type !== "custom") { ctx.ui.notify("Jewter: no verification suggestion on this branch", "info"); return; }
      ctx.ui.setEditorText((last.data as VerifyEntry).prompt); return;
    }
    if (command === "route") {
      const prompt = rest.join(" ");
      if (!prompt) { ctx.ui.notify("Usage: /jewter route <text>", "warning"); return; }
      const config = loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }).config;
      try {
        const start = Date.now(); const result = await classify(config, prompt);
        const decision = decide({ response: result.response, config });
        ctx.ui.notify(JSON.stringify({ decision, transport: result.transport, elapsedMs: Date.now() - start }, null, 2), "info");
      } catch (e) { ctx.ui.notify(`Jewter: ${e instanceof Error ? e.message : String(e)}`, "error"); }
      return;
    }
    ctx.ui.notify(USAGE, "warning");
  } });
}
