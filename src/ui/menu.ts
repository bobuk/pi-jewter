import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { configPaths, configuredModelRefs, isRoleId, loadConfig, resolveTier, THINKING_SETTINGS, TIER_NAMES, type TierName } from "../config.ts";
import { scanAgents } from "../subagents/catalog.ts";
import { writeAgentOverride } from "../subagents/integration.ts";
import { modelItem, pickWithSearch, sortModelItems, type PickItem, type PickScope } from "./picker.ts";

export function patchFile(path: string, patch: (data: Record<string, any>) => void): void {
  const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, any> : {};
  patch(data);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

export async function menu(ctx: ExtensionCommandContext, refresh: () => void, onDialog?: () => void): Promise<"done" | "dialog"> {
  if (!ctx.hasUI) return "done";
  let scope: "global" | "project" = "global";
  const paths = configPaths(ctx.cwd);
  const save = (fn: (data: Record<string, any>) => void) => {
    if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project is not trusted");
    patchFile(paths[scope], fn); refresh();
  };
  const config = () => loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }).config;
  /** Like the built-in /model selector: all models, models behind a login, and models already in use. */
  const modelScopes = (currentModel?: string): PickScope[] => {
    const available = ctx.modelRegistry.getAvailable().filter(m => m.api !== "pi-virtual");
    const items = sortModelItems(available.map(modelItem), currentModel);
    const logins = sortModelItems(available.filter(m => ctx.modelRegistry.isUsingOAuth(m)).map(modelItem), currentModel);
    const used = new Set(configuredModelRefs(config()));
    const scopes: PickScope[] = [{ id: "all", label: "all", items }];
    if (logins.length) scopes.push({ id: "logins", label: "logins", items: logins });
    const usedItems = items.filter(item => used.has(item.value));
    if (usedItems.length) scopes.push({ id: "used", label: "used", items: usedItems });
    return scopes;
  };
  const withPrefix = (scopes: PickScope[], item: PickItem): PickScope[] =>
    scopes.map(scope => ({ ...scope, items: [item, ...scope.items] }));
  const pickModel = async (title: string, currentModel: string | undefined, prefix?: PickItem): Promise<string | undefined> => {
    const scopes = modelScopes(currentModel);
    return pickWithSearch(ctx, title, scopes[0]!.items, { current: currentModel, scopes: prefix ? withPrefix(scopes, prefix) : scopes });
  };
  const selectTier = async (role?: string) => {
    const tier = await ctx.ui.select("Tier", [...TIER_NAMES]);
    if (!tier) return;
    const snapshot = config();
    const currentModel = role
      ? resolveTier(snapshot, role, tier as TierName).model
      : snapshot.tiers[tier as TierName]?.model;
    const inherit: PickItem = { value: "(inherit)", label: "(inherit)", description: "Use the default tier model" };
    const model = await pickModel(role ? `Model for role "${role}" · ${tier}` : `Default model · ${tier}`, currentModel, role ? inherit : undefined);
    if (!model) return;
    const thinking = model === "(inherit)" ? undefined : await ctx.ui.select("Thinking", [...THINKING_SETTINGS]);
    if (model !== "(inherit)" && !thinking) return;
    save(d => {
      if (role) {
        d.roles ??= {}; d.roles[role] ??= {}; d.roles[role].tiers ??= {};
        if (model === "(inherit)") d.roles[role].tiers[tier] = { model: null, thinking: null };
        else d.roles[role].tiers[tier] = { model, thinking };
      } else { d.tiers ??= {}; d.tiers[tier] = { model, thinking }; }
    });
  };
  let lastChoice: string | undefined;
  const rootItems = ["Scope", "Default tiers", "Roles", "Jev", "Compaction", "Subagents", "Visibility", "Configure in a chat with Pi", "Done"];
  while (true) {
    const c = config();
    // Remember the item so leaving a submenu returns to it instead of the first row.
    const choice = await pickWithSearch(ctx, `Jewter settings · ${scope}`, rootItems.map(value => ({ value, label: value })), { initial: lastChoice });
    if (!choice || choice === "Done") return "done";
    lastChoice = choice;
    if (choice === "Configure in a chat with Pi") { onDialog?.(); return "dialog"; }
    try {
      if (choice === "Scope") {
        const next = await ctx.ui.select("Scope", ["global", "project"]);
        if (next === "project" && !ctx.isProjectTrusted()) ctx.ui.notify("Project is not trusted", "warning");
        else if (next === "global" || next === "project") scope = next;
      } else if (choice === "Default tiers") await selectTier();
      else if (choice === "Roles") {
        const role = await ctx.ui.select("Roles", ["+ Create role", ...Object.keys(c.roles)]);
        if (!role) continue;
        if (role === "+ Create role") {
          const id = await ctx.ui.input("Role id (lowercase letters, digits, hyphens)");
          if (!id || !isRoleId(id) || id === "auto" || id === "none" || c.roles[id]) { ctx.ui.notify("Invalid or existing role", "warning"); continue; }
          const description = await ctx.ui.input("Role description for Jev", id);
          if (description === undefined) continue;
          save(d => { d.roles ??= {}; d.roles[id] = { description: description || id }; });
        } else {
          const action = await ctx.ui.select(role, ["Set tier", "Edit description", "Rename", "Delete"]);
          if (action === "Set tier") await selectTier(role);
          else if (action === "Edit description") {
            const description = await ctx.ui.input("Description", c.roles[role]?.description);
            if (description !== undefined) save(d => { d.roles ??= {}; d.roles[role] ??= {}; d.roles[role].description = description; });
          } else if (action === "Delete" && await ctx.ui.confirm("Delete role?", role)) save(d => { d.roles ??= {}; d.roles[role] = null; });
          else if (action === "Rename") {
            const id = await ctx.ui.input("New role id", role);
            if (id && isRoleId(id) && id !== "auto" && id !== "none" && !c.roles[id]) save(d => { d.roles ??= {}; d.roles[id] = c.roles[role]; d.roles[role] = null; });
          }
        }
      } else if (choice === "Jev") {
        const action = await ctx.ui.select("Jev", ["Transport", "Model override", "Endpoint override", "Timeout (ms)", "Confidence", "Fast threshold", "Strong threshold", "Tier majority"]);
        if (!action) continue;
        if (action === "Transport") {
          const transport = await ctx.ui.select("Transport", ["auto", "typesafe", "openrouter"]);
          if (transport) save(d => { d.jev ??= {}; d.jev.transport = transport; });
        } else {
          const keys: Record<string, string> = { "Model override": "model", "Endpoint override": "baseUrl", "Timeout (ms)": "timeoutMs", Confidence: "minConfidence", "Fast threshold": "fastMax", "Strong threshold": "strongMin", "Tier majority": "tierMajority" };
          const key = keys[action]!;
          const value = await ctx.ui.input(action, String((c.jev as unknown as Record<string, unknown>)[key] ?? ""));
          if (value === undefined) continue;
          if (!value.trim()) { save(d => { d.jev ??= {}; delete d.jev[key]; }); continue; }
          if (key === "model" || key === "baseUrl") {
            if (key === "baseUrl" && !/^https?:\/\//.test(value.trim())) throw new Error("Endpoint must start with http:// or https://");
            save(d => { d.jev ??= {}; d.jev[key] = value.trim(); });
            continue;
          }
          const n = Number(value);
          const [min, max] = key === "timeoutMs" ? [500, 120000] : [0, 1];
          if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${action} must be a number between ${min} and ${max}`);
          if (key === "fastMax" && n > c.jev.strongMin) throw new Error(`Fast threshold must not exceed the strong threshold (${c.jev.strongMin})`);
          if (key === "strongMin" && n < c.jev.fastMax) throw new Error(`Strong threshold must not be below the fast threshold (${c.jev.fastMax})`);
          save(d => { d.jev ??= {}; d.jev[key] = n; });
        }
      } else if (choice === "Compaction") {
        const action = await ctx.ui.select(`Compaction · ${c.compaction.enabled ? "on" : "off"}`, ["Enable / disable", "Fallback model", "Fallback thinking", "Minimum Jev confidence", "Minimum reduction", "Done"]);
        if (action === "Enable / disable") save(d => { d.compaction ??= {}; d.compaction.enabled = !c.compaction.enabled; });
        else if (action === "Fallback model") {
        const selected = await pickModel("Compaction fallback model", c.compaction.model ?? "(fast)", { value: "(fast)", label: "(fast)", description: "Inherit default fast tier" });
          if (selected) save(d => { d.compaction ??= {}; d.compaction.model = selected === "(fast)" ? null : selected; });
        } else if (action === "Fallback thinking") {
          const thinking = await ctx.ui.select("Compaction fallback thinking", [...THINKING_SETTINGS]);
          if (thinking) save(d => { d.compaction ??= {}; d.compaction.thinking = thinking; });
        } else if (action === "Minimum Jev confidence" || action === "Minimum reduction") {
          const key = action === "Minimum Jev confidence" ? "minConfidence" : "minReduction";
          const value = await ctx.ui.input(`${action} (0–1)`, String(c.compaction[key]));
          if (value !== undefined && value.trim()) {
            const n = Number(value);
            if (!Number.isFinite(n) || n < (key === "minConfidence" ? 0.5 : 0) || n > 1) throw new Error("Enter a valid number in range");
            save(d => { d.compaction ??= {}; d.compaction[key] = n; });
          }
        }
      } else if (choice === "Visibility") {
        const action = await ctx.ui.select("Visibility", ["Switch notification", `Request model report: ${c.ui.report ? "on" : "off"}`]);
        if (action === "Switch notification") {
          const notify = await ctx.ui.select("Switch notification", ["main", "all", "off"]);
          if (notify) save(d => { d.ui ??= {}; d.ui.notify = notify; });
        } else if (action?.startsWith("Request model report:")) {
          save(d => { d.ui ??= {}; d.ui.report = !c.ui.report; });
        }
      } else if (choice === "Subagents") {
        const agentDir = getAgentDir();
        const agents = scanAgents([
          { path: join(agentDir, "npm/node_modules/pi-subagents/agents"), scope: "builtin" },
          { path: join(agentDir, "agents"), scope: "global" },
          ...(ctx.isProjectTrusted() ? [{ path: join(ctx.cwd, ".pi/agents"), scope: "project" as const }] : []),
        ]);
        const agent = await pickWithSearch(ctx, "Subagent", agents.map(a => ({ value: a.name, label: a.name, description: a.scope })));
        if (!agent) continue;
        const selected = await ctx.ui.select(`Model for ${agent}`, ["auto", ...Object.keys(c.roles), "off (leave unchanged)"]);
        if (!selected || selected === "off (leave unchanged)") continue;
        if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project is not trusted");
        const settingsPath = scope === "global" ? join(agentDir, "settings.json") : join(ctx.cwd, ".pi/settings.json");
        if (await ctx.ui.confirm("Update Pi settings?", `${settingsPath}\n${agent} → jewter/${selected}\nAdd Jewter as a child-only extension; reload Pi to apply.`)) {
          writeAgentOverride(settingsPath, agent, `jewter/${selected}`, fileURLToPath(new URL("../index.ts", import.meta.url)));
          ctx.ui.notify("Saved. Run /reload to apply subagent settings.", "info");
        }
      }
    } catch (e) { ctx.ui.notify(`Jewter: ${e instanceof Error ? e.message : String(e)}`, "error"); }
  }
}
