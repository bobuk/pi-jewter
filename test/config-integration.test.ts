import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyEnv, configPaths, DEFAULT_JEV_MAX_RESPONSE_BYTES, defaultConfig, loadConfig, mergeConfig, normalizeConfig, resolveTier } from "../src/config.ts";
import { toggleRouting } from "../src/commands/jewter.ts";
import { scanAgents } from "../src/subagents/catalog.ts";
import { setAgentOverride, writeAgentOverride } from "../src/subagents/integration.ts";
import { patchFile } from "../src/ui/menu.ts";

test("global/project/env precedence, role inheritance, untrusted project", () => {
  const d = mkdtempSync(join(tmpdir(), "jewter-config-")); mkdirSync(join(d, ".pi"));
  // Global config lives in Pi's agent directory (PI_CODING_AGENT_DIR), not a hardcoded home path.
  const agentDir = mkdtempSync(join(tmpdir(), "jewter-agent-"));
  writeFileSync(join(agentDir, "jewter.json"), JSON.stringify({tiers:{medium:{model:"openrouter/a",thinking:"high"}},roles:{planning:{tiers:{strong:{model:"openrouter/b"}}}},jev:{transport:"typesafe"}}));
  writeFileSync(join(d,".pi/jewter.json"), JSON.stringify({tiers:{medium:{model:"openrouter/c"}},roles:{review:null}}));
  const loaded = loadConfig({cwd:d, agentDir, env:{JEWTER_TRANSPORT:"openrouter"}, projectTrusted:true}).config;
  assert.deepEqual(resolveTier(loaded,"planning","medium"),{model:"openrouter/c",thinking:"high"});
  assert.equal(resolveTier(loaded,"planning","strong").model,"openrouter/b");
  assert.equal(loaded.roles.review, undefined); assert.equal(loaded.jev.transport,"openrouter");
  assert.equal(resolveTier(loadConfig({cwd:d, agentDir, env:{}, projectTrusted:false}).config,"planning","medium").model,"openrouter/a");
});

test("agent settings merge preserves unrelated keys, unbinds cleanly, and cleans up temp files", () => {
  const initial = { theme:"dark", subagents:{agentOverrides:{scout:{thinking:"low",subagentOnlyExtensions:["other.ts"]}}} };
  const result = setAgentOverride(initial, "scout", "jewter/auto", "/tmp/pi-jewter/src/index.ts");
  assert.deepEqual(result, {theme:"dark",subagents:{agentOverrides:{scout:{thinking:"low",model:"jewter/auto",subagentOnlyExtensions:["other.ts","/tmp/pi-jewter/src/index.ts"]}}}});
  assert.equal(setAgentOverride(initial,"scout",null,"/tmp/pi-jewter/src/index.ts"), initial);
  // Unbinding removes Jewter's model and extension while preserving thinking and other extensions.
  assert.deepEqual(setAgentOverride(result, "scout", null, "/moved/pi-jewter/src/index.ts"), initial);
  // Unbinding an agent whose only settings came from Jewter removes empty wrapper objects.
  const minimalBound = setAgentOverride({ theme: "dark" }, "worker", "jewter/implementation", "/tmp/pi-jewter/src/index.ts");
  assert.deepEqual(setAgentOverride(minimalBound, "worker", null, "/tmp/pi-jewter/src/index.ts"), { theme: "dark" });
  // Non-Jewter physical models are never removed by unbinding.
  const physical = { subagents: { agentOverrides: { reviewer: { model: "anthropic/claude-opus-5-5" } } } };
  assert.equal(setAgentOverride(physical, "reviewer", null, "/tmp/pi-jewter/src/index.ts"), physical);

  const d=mkdtempSync(join(tmpdir(),"jewter-settings-")); const path=join(d,"settings.json");
  writeFileSync(path,JSON.stringify(initial)); writeAgentOverride(path,"scout","jewter/auto","/tmp/pi-jewter/src/index.ts");
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),result);
  writeAgentOverride(path,"scout",null,"/tmp/pi-jewter/src/index.ts");
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),initial);
  writeFileSync(path,"not json");
  assert.throws(()=>writeAgentOverride(path,"scout","jewter/auto"), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(readFileSync(path,"utf8"),"not json");

  // Failed rename onto a directory cleans up the temporary file.
  const dirTarget = join(d, "dir-target");
  mkdirSync(dirTarget);
  assert.throws(() => patchFile(dirTarget, obj => { obj.enabled = true; }));
  assert.throws(() => writeAgentOverride(dirTarget, "scout", "jewter/auto"));
  assert.deepEqual(readdirSync(d).filter(name => name.endsWith(".tmp")), []);

  // patchFile includes the path when existing JSON is malformed or non-object.
  const broken = join(d, "broken.json");
  writeFileSync(broken, "{bad");
  assert.throws(() => patchFile(broken, obj => { obj.enabled = true; }), /broken\.json: invalid JSON/);
  writeFileSync(broken, "[]");
  assert.throws(() => patchFile(broken, obj => { obj.enabled = true; }), /broken\.json: expected a JSON object/);
});

test("agent discovery honors project precedence", () => {
  const d=mkdtempSync(join(tmpdir(),"jewter-agents-")); const a=join(d,"a"), b=join(d,"b"); mkdirSync(a);mkdirSync(b);
  writeFileSync(join(a,"x.md"),"---\nname: scout\n---\n");writeFileSync(join(b,"y.md"),"---\nname: scout\n---\n");
  assert.deepEqual(scanAgents([{path:a,scope:"builtin"},{path:b,scope:"project"}]),[{name:"scout",path:join(b,"y.md"),scope:"project"}]);
});

test("configPaths resolves the global file under the given agent directory", () => {
  assert.deepEqual(configPaths("/work/project", "/custom/agent"), { global: "/custom/agent/jewter.json", project: "/work/project/.pi/jewter.json" });
});

test("verification ships thinking-only overrides that keep tier models and survive a model override", () => {
  const d = mkdtempSync(join(tmpdir(), "jewter-verify-"));
  const agentDir = mkdtempSync(join(tmpdir(), "jewter-agent-"));
  writeFileSync(join(agentDir, "jewter.json"), JSON.stringify({
    tiers: { fast: { model: "x/fast", thinking: "low" }, medium: { model: "x/mid", thinking: "medium" }, strong: { model: "x/big", thinking: "medium" } },
    roles: { verification: { tiers: { strong: { model: "x/opus" } } } },
  }));
  const config = loadConfig({ cwd: d, agentDir, env: {}, projectTrusted: false }).config;
  assert.deepEqual(resolveTier(config, "verification", "fast"), { model: "x/fast", thinking: "medium" });
  assert.deepEqual(resolveTier(config, "verification", "medium"), { model: "x/mid", thinking: "high" });
  // A user-set model keeps the shipped thinking override unless thinking is set too.
  assert.deepEqual(resolveTier(config, "verification", "strong"), { model: "x/opus", thinking: "high" });
  assert.deepEqual(resolveTier(config, "implementation", "medium"), { model: "x/mid", thinking: "medium" });
});

test("a removed verification role stays removed", () => {
  const d = mkdtempSync(join(tmpdir(), "jewter-verify-"));
  const agentDir = mkdtempSync(join(tmpdir(), "jewter-agent-"));
  writeFileSync(join(agentDir, "jewter.json"), JSON.stringify({ roles: { verification: null } }));
  assert.equal(loadConfig({ cwd: d, agentDir, env: {}, projectTrusted: false }).config.roles.verification, undefined);
});

test("shipped profiles load cleanly and differ only in the expert model", () => {
  const read = (name: string) => readFileSync(new URL(`../examples/jewter.${name}.json`, import.meta.url), "utf8");
  for (const name of ["price", "quality"]) {
    const d = mkdtempSync(join(tmpdir(), "jewter-profile-"));
    const agentDir = mkdtempSync(join(tmpdir(), "jewter-agent-"));
    writeFileSync(join(agentDir, "jewter.json"), read(name));
    const loaded = loadConfig({ cwd: d, agentDir, env: {}, projectTrusted: false });
    assert.deepEqual(loaded.warnings, [], name);
    const c = loaded.config;
    assert.equal(c.tiers.medium.thinking, "medium", name);
    assert.equal(c.tiers.strong.thinking, "medium", name);
    assert.equal(resolveTier(c, "verification", "strong").thinking, "high", name);
    assert.equal(resolveTier(c, "verification", "strong").model, c.tiers.strong.model, name);
    assert.equal(resolveTier(c, "review", "medium").model, c.tiers.strong.model, name);
  }
  const price = read("price").replaceAll("openrouter/deepseek/deepseek-v4.1-flash", "EXPERT");
  const quality = read("quality").replaceAll("claude-bridge/claude-opus-5-5", "EXPERT");
  // Planning sketches on the fast tier are the one intended difference: luna for price, the expert for quality.
  assert.equal(price.replace(/("fast": \{\s*"model": )"openai-codex\/gpt-6-luna"(,\s*"thinking": "low"\s*\},\s*"medium": \{\s*"model": "EXPERT")/, "$1\"EXPERT\"$2"), quality);
});

test("mergeConfig ignores prototype-polluting keys and Object.prototype collisions", () => {
  const malicious = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"toString":{"nested":1},"roles":{"custom":{"__proto__":{"polluted":"yes"},"description":"ok"}}}');
  const merged = mergeConfig(defaultConfig() as unknown as Record<string, unknown>, malicious);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(typeof merged.toString, "object");
  assert.equal((merged.roles as Record<string, { description?: string }>).custom?.description, "ok");
  assert.equal(Object.hasOwn((merged.roles as Record<string, object>).custom!, "__proto__"), false);
});

test("jev.maxResponseBytes normalizes, clamps, and honors environment override", () => {
  assert.equal(defaultConfig().jev.maxResponseBytes, DEFAULT_JEV_MAX_RESPONSE_BYTES);
  assert.equal(normalizeConfig({ jev: { maxResponseBytes: 500 } }).config.jev.maxResponseBytes, 1024);
  assert.equal(normalizeConfig({ jev: { maxResponseBytes: 99_000_000 } }).config.jev.maxResponseBytes, 10_000_000);
  assert.equal(normalizeConfig({ jev: { maxResponseBytes: 64_000 } }).config.jev.maxResponseBytes, 64_000);
  assert.equal(applyEnv(defaultConfig(), { JEWTER_JEV_MAX_RESPONSE_BYTES: "128000" }).jev.maxResponseBytes, 128_000);
  assert.equal(applyEnv(defaultConfig(), { JEWTER_JEV_MAX_RESPONSE_BYTES: "100" }).jev.maxResponseBytes, 1024);
  assert.equal(applyEnv(defaultConfig(), { JEWTER_JEV_MAX_RESPONSE_BYTES: "not-a-number" }).jev.maxResponseBytes, DEFAULT_JEV_MAX_RESPONSE_BYTES);
});

test("toggleRouting warns accurately when project config, env, or jev.enabled overrides global toggle", () => {
  const cwd = mkdtempSync(join(tmpdir(), "jewter-toggle-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "jewter-toggle-agent-"));
  mkdirSync(join(cwd, ".pi"));

  assert.deepEqual(toggleRouting(false, { cwd, agentDir, env: {}, projectTrusted: true }), {
    level: "info",
    message: "Jewter off",
  });
  assert.equal(loadConfig({ cwd, agentDir, env: {}, projectTrusted: true }).config.enabled, false);

  // Trusted project explicitly disables routing; global `/jewter on` warns instead of lying.
  writeFileSync(join(cwd, ".pi", "jewter.json"), JSON.stringify({ enabled: false }));
  const projectOverride = toggleRouting(true, { cwd, agentDir, env: {}, projectTrusted: true });
  assert.equal(projectOverride.level, "warning");
  assert.match(projectOverride.message, /remains off.*\.pi\/jewter\.json/);

  // Explicit project scope updates `.pi/jewter.json` when trusted, and refuses when untrusted.
  assert.equal(toggleRouting(true, { cwd, agentDir, env: {}, projectTrusted: false, scope: "project" }).level, "warning");
  assert.deepEqual(toggleRouting(true, { cwd, agentDir, env: {}, projectTrusted: true, scope: "project" }), {
    level: "info",
    message: "Jewter on (project)",
  });

  // Environment override is identified separately from project config.
  const envOverride = toggleRouting(true, { cwd, agentDir, env: { JEWTER_DISABLED: "1" }, projectTrusted: true });
  assert.equal(envOverride.level, "warning");
  assert.match(envOverride.message, /JEWTER_DISABLED/);

  // Disabled Jev classifier is surfaced when enabling routing.
  writeFileSync(join(cwd, ".pi", "jewter.json"), JSON.stringify({ enabled: true, jev: { enabled: false } }));
  const jevDisabled = toggleRouting(true, { cwd, agentDir, env: {}, projectTrusted: true });
  assert.equal(jevDisabled.level, "warning");
  assert.match(jevDisabled.message, /jev\.enabled is false/);
});
