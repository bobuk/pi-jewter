import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.ts";
import {
  advancedSummary, compactionSummary, defaultTiersSummary, displaySummary, modelsSummary,
  roleTiersSummary, shortModel, subagentBindings,
} from "../src/ui/summary.ts";

function configured() {
  const c = defaultConfig();
  c.tiers.fast = { model: "openai-codex/gpt-6-luna", thinking: "low" };
  c.tiers.medium = { model: "openai-codex/gpt-6.1-sol", thinking: "high" };
  c.tiers.strong = { model: "openrouter/deepseek/deepseek-v4.1-flash", thinking: "max" };
  c.roles.review = { description: "Review", tiers: { medium: { model: "anthropic/claude-opus-5-5" }, strong: { model: "anthropic/claude-opus-5-5" } } };
  return c;
}

test("shortModel keeps only the last path segment", () => {
  assert.equal(shortModel("openrouter/deepseek/deepseek-v4.1-flash"), "deepseek-v4.1-flash");
  assert.equal(shortModel("openai-codex/gpt-6-luna"), "gpt-6-luna");
  assert.equal(shortModel(undefined), "—");
});

test("models row summarizes default tiers and role count", () => {
  const c = configured();
  assert.equal(defaultTiersSummary(c), "gpt-6-luna · gpt-6.1-sol · deepseek-v4.1-flash");
  assert.equal(modelsSummary(c), "fast gpt-6-luna · medium gpt-6.1-sol · strong deepseek-v4.1-flash · 5 roles");
  assert.match(modelsSummary(defaultConfig()), /fast — · medium — · strong — · 5 roles/);
});

test("role rows mark inherited tiers in parentheses", () => {
  const c = configured();
  assert.equal(roleTiersSummary(c, "review"), "(gpt-6-luna) · claude-opus-5-5 · claude-opus-5-5");
  assert.equal(roleTiersSummary(c, "implementation"), "(inherits)");
});

test("compaction, display and advanced rows show current values", () => {
  const c = configured();
  assert.equal(compactionSummary(c), "off");
  c.compaction.enabled = true;
  assert.equal(compactionSummary(c), "on · gpt-6-luna");
  c.compaction.model = "anthropic/claude-haiku-5-5";
  assert.equal(compactionSummary(c), "on · claude-haiku-5-5");
  assert.equal(displaySummary(c), "notify main · report on");
  assert.equal(advancedSummary(c), "Jev auto · confidence 0.6");
  c.enabled = false;
  assert.equal(advancedSummary(c), "routing off · Jev auto · confidence 0.6");
});

test("subagent bindings read only jewter models from Pi settings", () => {
  assert.deepEqual(subagentBindings({ subagents: { agentOverrides: {
    worker: { model: "jewter/implementation" },
    scout: { model: "jewter/auto", thinking: "low" },
    reviewer: { model: "anthropic/claude-opus-5-5" },
    planner: { model: "" },
  } } }), { worker: "implementation", scout: "auto" });
  assert.deepEqual(subagentBindings(undefined), {});
  assert.deepEqual(subagentBindings({ subagents: "bad" }), {});
});
