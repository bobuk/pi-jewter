import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, loadConfig, resolveTier } from "../src/config.ts";
import { scanAgents } from "../src/subagents/catalog.ts";
import { setAgentOverride, writeAgentOverride } from "../src/subagents/integration.ts";

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

test("agent settings merge preserves unrelated keys and adds extension", () => {
  const initial = { theme:"dark", subagents:{agentOverrides:{scout:{thinking:"low",subagentOnlyExtensions:["other.ts"]}}} };
  const result = setAgentOverride(initial, "scout", "jewter/auto", "/tmp/jewter.ts");
  assert.deepEqual(result, {theme:"dark",subagents:{agentOverrides:{scout:{thinking:"low",model:"jewter/auto",subagentOnlyExtensions:["other.ts","/tmp/jewter.ts"]}}}});
  assert.deepEqual(setAgentOverride(initial,"scout",null),initial);
  const d=mkdtempSync(join(tmpdir(),"jewter-settings-")); const path=join(d,"settings.json");
  writeFileSync(path,JSON.stringify(initial)); writeAgentOverride(path,"scout","jewter/auto","/tmp/jewter.ts");
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),result);
  writeFileSync(path,"not json"); assert.throws(()=>writeAgentOverride(path,"scout","jewter/auto"));
  assert.equal(readFileSync(path,"utf8"),"not json");
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
