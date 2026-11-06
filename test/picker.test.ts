import test from "node:test";
import assert from "node:assert/strict";
import { configPaths, configuredModelRefs, defaultConfig } from "../src/config.ts";
import { modelItem, sortModelItems, type PickItem } from "../src/ui/picker.ts";
import { setupDialogPrompt } from "../src/commands/dialog.ts";

test("model items show the id first with provider and capability badges", () => {
  const item = modelItem({ provider: "openai-codex", id: "gpt-6.1-sol", name: "GPT-6.1 Sol", contextWindow: 400_000, reasoning: true });
  assert.equal(item.value, "openai-codex/gpt-6.1-sol");
  assert.equal(item.label, "gpt-6.1-sol");
  assert.match(item.description!, /\[openai-codex\]/);
  assert.match(item.description!, /400K ctx/);
  assert.match(item.description!, /reasoning/);
  assert.equal(modelItem({ provider: "p", id: "m", reasoning: false }).description, "[p] · no reasoning");
});

test("sorting puts the current model first, then provider and id", () => {
  const items: PickItem[] = [
    { value: "openrouter/openai/gpt-6.1-sol" },
    { value: "amazon-bedrock/x" },
    { value: "openai-codex/gpt-6.1-terra" },
    { value: "openai-codex/gpt-6.1-sol" },
    { value: "anthropic/claude-opus-5.5" },
  ];
  const sorted = sortModelItems(items, "openrouter/openai/gpt-6.1-sol").map(i => i.value);
  assert.deepEqual(sorted, [
    "openrouter/openai/gpt-6.1-sol",
    "amazon-bedrock/x",
    "anthropic/claude-opus-5.5",
    "openai-codex/gpt-6.1-sol",
    "openai-codex/gpt-6.1-terra",
  ]);
  assert.deepEqual(sortModelItems(items).map(i => i.value)[0], "amazon-bedrock/x");
});

test("configured model refs collect tiers, role overrides and the compaction fallback", () => {
  const config = defaultConfig();
  config.tiers.fast.model = "openai-codex/gpt-6.1-terra";
  config.tiers.strong.model = "anthropic/claude-opus-5.5";
  config.roles.review = { tiers: { strong: { model: "anthropic/claude-opus-5.5" }, medium: { model: "openai-codex/gpt-6.1-sol" } } };
  config.compaction.model = "openai-codex/gpt-6-luna";
  assert.deepEqual(configuredModelRefs(config).sort(), [
    "anthropic/claude-opus-5.5",
    "openai-codex/gpt-6-luna",
    "openai-codex/gpt-6.1-sol",
    "openai-codex/gpt-6.1-terra",
  ]);
  assert.deepEqual(configuredModelRefs(defaultConfig()), []);
});

test("setup dialog prompt names both config files, available models and consent", () => {
  const prompt = setupDialogPrompt("/work/project");
  const paths = configPaths("/work/project");
  assert.ok(prompt.includes(paths.global));
  assert.ok(prompt.includes(paths.project));
  assert.match(prompt, /pi --list-models/);
  assert.match(prompt, /openai-codex/);
  assert.match(prompt, /planning, implementation, review, research, quick/);
  assert.match(prompt, /Do not write anything until I confirm/);
  assert.match(prompt, /"provider\/id"/);
  assert.match(prompt, /\/reload/);
  assert.doesNotMatch(prompt, /undefined|null/);
});
