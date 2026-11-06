import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { configPaths, configuredModelRefs, isRoleId, loadConfig, NOTIFY_MODES, resolveTier, THINKING_SETTINGS, TIER_NAMES, TRANSPORTS, type TierName } from "../config.ts";
import { scanAgents } from "../subagents/catalog.ts";
import { writeAgentOverride } from "../subagents/integration.ts";
import { modelItem, pickWithSearch, sortModelItems, type PickItem, type PickScope } from "./picker.ts";
import {
  advancedSummary, compactionSummary, defaultTiersSummary, displaySummary, modelsSummary,
  onOff, roleTiersSummary, shortModel, subagentBindings,
} from "./summary.ts";

export function patchFile(path: string, patch: (data: Record<string, any>) => void): void {
  const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, any> : {};
  patch(data);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temp, path);
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

const SCOPE_TAB = "@scope";
const DIALOG = "Configure in a chat with Pi";
const NEW_ROLE = "@new-role";
const DEFAULT_ROW = "@default";

export async function menu(ctx: ExtensionCommandContext, refresh: () => void, onDialog?: () => void): Promise<"done" | "dialog"> {
  if (!ctx.hasUI) return "done";
  let scope: "global" | "project" = "global";
  const paths = configPaths(ctx.cwd);
  const save = (fn: (data: Record<string, any>) => void) => {
    if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project is not trusted");
    patchFile(paths[scope], fn); refresh();
  };
  const config = () => loadConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() }).config;
  const settingsPath = () => scope === "global" ? join(getAgentDir(), "settings.json") : join(ctx.cwd, ".pi", "settings.json");

  /** A submenu that stays open after each action and keeps the cursor on the last item. Esc leaves. */
  const submenu = async (title: string, items: () => PickItem[], handle: (choice: string) => Promise<void> | void) => {
    let last: string | undefined;
    while (true) {
      const choice = await pickWithSearch(ctx, `${title} · ${scope}`, items(), { initial: last });
      if (!choice) return;
      last = choice;
      try { await handle(choice); } catch (e) { ctx.ui.notify(`Jewter: ${e instanceof Error ? e.message : String(e)}`, "error"); }
    }
  };

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
  const pickModel = async (title: string, currentModel: string | undefined, prefix?: PickItem): Promise<string | undefined> => {
    const scopes = modelScopes(currentModel).map(s => (prefix ? { ...s, items: [prefix, ...s.items] } : s));
    return pickWithSearch(ctx, title, scopes[0]!.items, { current: currentModel, scopes });
  };
  const pickThinking = async (title: string, current?: string): Promise<string | undefined> =>
    pickWithSearch(ctx, title, THINKING_SETTINGS.map(value => ({ value, label: value })), { current, initial: current });

  const editTier = async (role?: string) => {
    const snapshot = config();
    const tier = await pickWithSearch(ctx, role ? `Tier · ${role}` : "Default tier", TIER_NAMES.map(name => {
      const effective = role ? resolveTier(snapshot, role, name) : snapshot.tiers[name];
      return { value: name, label: name, description: `${shortModel(effective?.model)} · ${effective?.thinking ?? "auto"}` };
    }));
    if (!tier) return;
    const current = role ? resolveTier(snapshot, role, tier as TierName) : snapshot.tiers[tier as TierName];
    const inherit: PickItem = { value: "(inherit)", label: "(inherit)", description: "Use the default tier model" };
    const model = await pickModel(role ? `Model · ${role} · ${tier}` : `Default model · ${tier}`, current?.model, role ? inherit : undefined);
    if (!model) return;
    if (model === "(inherit)") {
      save(d => { d.roles ??= {}; d.roles[role!] ??= {}; d.roles[role!].tiers ??= {}; d.roles[role!].tiers[tier] = { model: null, thinking: null }; });
      return;
    }
    const thinking = await pickThinking(`Thinking · ${shortModel(model)}`, current?.thinking);
    if (!thinking) return;
    save(d => {
      if (role) { d.roles ??= {}; d.roles[role] ??= {}; d.roles[role].tiers ??= {}; d.roles[role].tiers[tier] = { model, thinking }; }
      else { d.tiers ??= {}; d.tiers[tier] = { model, thinking }; }
    });
  };

  const askRoleId = async (title: string, initial?: string): Promise<string | undefined> => {
    const id = (await ctx.ui.input(title, initial))?.trim();
    if (!id) return undefined;
    if (!isRoleId(id) || id === "auto" || id === "none" || config().roles[id]) throw new Error("Role id must be new and use lowercase letters, digits and hyphens");
    return id;
  };

  const editRole = async (role: string) => {
    const c = config();
    const action = await pickWithSearch(ctx, `Role · ${role}`, [
      { value: "tier", label: "Set tier model", description: roleTiersSummary(c, role) },
      { value: "description", label: "Edit description", description: c.roles[role]?.description ?? role },
      { value: "rename", label: "Rename" },
      { value: "delete", label: "Delete" },
    ]);
    if (action === "tier") await editTier(role);
    else if (action === "description") {
      const description = await ctx.ui.input("Description for Jev", c.roles[role]?.description);
      if (description !== undefined) save(d => { d.roles ??= {}; d.roles[role] ??= {}; d.roles[role].description = description; });
    } else if (action === "rename") {
      const id = await askRoleId("New role id", role);
      if (id) save(d => { d.roles ??= {}; d.roles[id] = c.roles[role]; d.roles[role] = null; });
    } else if (action === "delete" && await ctx.ui.confirm("Delete role?", role)) {
      save(d => { d.roles ??= {}; d.roles[role] = null; });
    }
  };

  const modelsMenu = () => submenu("Models", () => {
    const c = config();
    return [
      { value: DEFAULT_ROW, label: "Default", description: defaultTiersSummary(c) },
      ...Object.keys(c.roles).map(role => ({ value: role, label: role, description: roleTiersSummary(c, role) })),
      { value: NEW_ROLE, label: "+ New role" },
    ];
  }, async choice => {
    if (choice === DEFAULT_ROW) return editTier();
    if (choice === NEW_ROLE) {
      const id = await askRoleId("Role id (lowercase letters, digits, hyphens)");
      if (!id) return;
      const description = await ctx.ui.input("Role description for Jev", id);
      if (description !== undefined) save(d => { d.roles ??= {}; d.roles[id] = { description: description || id }; });
      return;
    }
    return editRole(choice);
  });

  const subagentsMenu = () => submenu("Subagents", () => {
    const agentDir = getAgentDir();
    const bound = subagentBindings(readJson(settingsPath()));
    const agents: { name: string; scope: string }[] = scanAgents([
      { path: join(agentDir, "npm/node_modules/pi-subagents/agents"), scope: "builtin" },
      { path: join(agentDir, "agents"), scope: "global" },
      ...(ctx.isProjectTrusted() ? [{ path: join(ctx.cwd, ".pi/agents"), scope: "project" as const }] : []),
    ]);
    // Bindings in settings for agents with no definition stay visible instead of silently disappearing.
    const known = new Set(agents.map(agent => agent.name));
    for (const name of Object.keys(bound)) if (!known.has(name)) agents.push({ name, scope: "missing" });
    return agents
      // Bound agents first, so the ones routed through Jewter are visible without scrolling.
      .sort((a, b) => Number(!bound[a.name]) - Number(!bound[b.name]) || a.name.localeCompare(b.name))
      .map(agent => ({
        value: agent.name,
        label: agent.name,
        description: bound[agent.name]
          ? `→ ${bound[agent.name]}${agent.scope === "missing" ? " · agent definition not found" : ""}`
          : `unbound · ${agent.scope}`,
      }));
  }, async agent => {
    const c = config();
    const current = subagentBindings(readJson(settingsPath()))[agent];
    const selected = await pickWithSearch(ctx, `Route ${agent} through`, [
      { value: "auto", label: "auto", description: "Jev picks role and tier per task" },
      ...Object.keys(c.roles).map(role => ({ value: role, label: role, description: "fallback role; Jev may still switch" })),
      { value: "off", label: "off", description: "leave the agent's settings unchanged" },
    ], { current, initial: current });
    if (!selected || selected === "off") return;
    if (scope === "project" && !ctx.isProjectTrusted()) throw new Error("Project is not trusted");
    const path = settingsPath();
    if (await ctx.ui.confirm("Update Pi settings?", `${path}\n${agent} → jewter/${selected}\nAdd Jewter as a child-only extension; reload Pi to apply.`)) {
      writeAgentOverride(path, agent, `jewter/${selected}`, fileURLToPath(new URL("../index.ts", import.meta.url)));
      ctx.ui.notify("Saved. Run /reload to apply subagent settings.", "info");
    }
  });

  const compactionMenu = () => submenu("Compaction", () => {
    const c = config();
    return [
      { value: "enabled", label: "Enabled", description: onOff(c.compaction.enabled) },
      { value: "model", label: "Fallback model", description: c.compaction.model ? shortModel(c.compaction.model) : `(fast) ${shortModel(c.tiers.fast.model)}` },
      { value: "thinking", label: "Fallback thinking", description: c.compaction.thinking },
    ];
  }, async choice => {
    const c = config();
    if (choice === "enabled") save(d => { d.compaction ??= {}; d.compaction.enabled = !c.compaction.enabled; });
    else if (choice === "model") {
      const selected = await pickModel("Compaction fallback model", c.compaction.model ?? "(fast)", { value: "(fast)", label: "(fast)", description: "Inherit default fast tier" });
      if (selected) save(d => { d.compaction ??= {}; d.compaction.model = selected === "(fast)" ? null : selected; });
    } else if (choice === "thinking") {
      const thinking = await pickThinking("Compaction fallback thinking", c.compaction.thinking);
      if (thinking) save(d => { d.compaction ??= {}; d.compaction.thinking = thinking; });
    }
  });

  const displayMenu = () => submenu("Display", () => {
    const c = config();
    return [
      { value: "notify", label: "Switch notifications", description: c.ui.notify },
      { value: "footer", label: "Footer status", description: onOff(c.ui.footer) },
      { value: "cards", label: "Routing cards", description: onOff(c.ui.cards) },
      { value: "report", label: "Model report", description: onOff(c.ui.report) },
    ];
  }, async choice => {
    const c = config();
    if (choice === "notify") {
      const notify = await pickWithSearch(ctx, "Switch notifications", NOTIFY_MODES.map(value => ({
        value, label: value, description: value === "main" ? "main session only" : value === "all" ? "including subagents" : "footer and report only",
      })), { current: c.ui.notify, initial: c.ui.notify });
      if (notify) save(d => { d.ui ??= {}; d.ui.notify = notify; });
    } else if (choice === "footer" || choice === "cards" || choice === "report") {
      save(d => { d.ui ??= {}; d.ui[choice] = !c.ui[choice]; });
    }
  });

  const numberField = async (label: string, current: number, min: number, max: number): Promise<number | null | undefined> => {
    const value = await ctx.ui.input(`${label} (${min}–${max}, empty to reset)`, String(current));
    if (value === undefined) return undefined;
    if (!value.trim()) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be a number between ${min} and ${max}`);
    return n;
  };

  const advancedMenu = () => submenu("Advanced", () => {
    const c = config();
    return [
      { value: "routing", label: "Routing", description: onOff(c.enabled) },
      { value: "transport", label: "Jev transport", description: c.jev.transport },
      { value: "model", label: "Jev model", description: c.jev.model ?? "default" },
      { value: "baseUrl", label: "Jev endpoint", description: c.jev.baseUrl ?? "default" },
      { value: "timeoutMs", label: "Jev timeout (ms)", description: String(c.jev.timeoutMs) },
      { value: "minConfidence", label: "Role confidence", description: String(c.jev.minConfidence) },
      { value: "fastMax", label: "Fast threshold", description: String(c.jev.fastMax) },
      { value: "strongMin", label: "Strong threshold", description: String(c.jev.strongMin) },
      { value: "tierMajority", label: "Tier majority", description: String(c.jev.tierMajority) },
      { value: "compaction.minConfidence", label: "Compaction Jev confidence", description: String(c.compaction.minConfidence) },
      { value: "compaction.minReduction", label: "Compaction min reduction", description: String(c.compaction.minReduction) },
    ];
  }, async choice => {
    const c = config();
    if (choice === "routing") return save(d => { d.enabled = !c.enabled; });
    if (choice === "transport") {
      const transport = await pickWithSearch(ctx, "Jev transport", TRANSPORTS.map(value => ({ value, label: value })), { current: c.jev.transport, initial: c.jev.transport });
      if (transport) save(d => { d.jev ??= {}; d.jev.transport = transport; });
      return;
    }
    if (choice === "model" || choice === "baseUrl") {
      const value = await ctx.ui.input(choice === "model" ? "Jev model (empty for default)" : "Jev endpoint (empty for default)", c.jev[choice] ?? "");
      if (value === undefined) return;
      if (choice === "baseUrl" && value.trim() && !/^https?:\/\//.test(value.trim())) throw new Error("Endpoint must start with http:// or https://");
      save(d => { d.jev ??= {}; if (value.trim()) d.jev[choice] = value.trim(); else delete d.jev[choice]; });
      return;
    }
    if (choice.startsWith("compaction.")) {
      const key = choice.slice("compaction.".length) as "minConfidence" | "minReduction";
      const n = await numberField(key === "minConfidence" ? "Compaction Jev confidence" : "Compaction min reduction", c.compaction[key], key === "minConfidence" ? 0.5 : 0, 1);
      if (n !== undefined) save(d => { d.compaction ??= {}; if (n === null) delete d.compaction[key]; else d.compaction[key] = n; });
      return;
    }
    const key = choice as "timeoutMs" | "minConfidence" | "fastMax" | "strongMin" | "tierMajority";
    const [min, max] = key === "timeoutMs" ? [500, 120000] : key === "tierMajority" ? [0.34, 1] : [0, 1];
    const n = await numberField(key, c.jev[key], min, max);
    if (n === undefined) return;
    if (key === "fastMax" && n !== null && n > c.jev.strongMin) throw new Error(`Fast threshold must not exceed the strong threshold (${c.jev.strongMin})`);
    if (key === "strongMin" && n !== null && n < c.jev.fastMax) throw new Error(`Strong threshold must not be below the fast threshold (${c.jev.fastMax})`);
    save(d => { d.jev ??= {}; if (n === null) delete d.jev[key]; else d.jev[key] = n; });
  });

  let lastChoice: string | undefined;
  while (true) {
    const c = config();
    const items: PickItem[] = [
      { value: DIALOG, label: DIALOG },
      { value: "Models", label: "Models", description: modelsSummary(c) },
      { value: "Subagents", label: "Subagents", description: `${Object.keys(subagentBindings(readJson(settingsPath()))).length} bound` },
      { value: "Compaction", label: "Compaction", description: compactionSummary(c) },
      { value: "Display", label: "Display", description: displaySummary(c) },
      { value: "Advanced", label: "Advanced", description: advancedSummary(c) },
    ];
    // Remember the item so leaving a submenu returns to it instead of the first row.
    const choice = await pickWithSearch(ctx, `Jewter · ${scope}`, items, {
      initial: lastChoice,
      tabResult: SCOPE_TAB,
      subtitle: `Tab: global ⇄ project${ctx.isProjectTrusted() ? "" : " (project not trusted)"}`,
    });
    if (!choice) return "done";
    if (choice === SCOPE_TAB) {
      if (scope === "global" && !ctx.isProjectTrusted()) ctx.ui.notify("Project is not trusted; project settings are unavailable", "warning");
      else scope = scope === "global" ? "project" : "global";
      continue;
    }
    lastChoice = choice;
    if (choice === DIALOG) { onDialog?.(); return "dialog"; }
    try {
      if (choice === "Models") await modelsMenu();
      else if (choice === "Subagents") await subagentsMenu();
      else if (choice === "Compaction") await compactionMenu();
      else if (choice === "Display") await displayMenu();
      else if (choice === "Advanced") await advancedMenu();
    } catch (e) { ctx.ui.notify(`Jewter: ${e instanceof Error ? e.message : String(e)}`, "error"); }
  }
}
