import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { streamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { fallbackOutputBudget } from "../src/compaction/extension.ts";

const base = getBuiltinModel("anthropic", "claude-haiku-4-5");
assert.ok(base);
const model = { ...base, contextWindow: 64000, maxTokens: 16384, compat: { ...base.compat, forceAdaptiveThinking: false } };

for (const thinking of ["off", "low", "high"] as const) {
  test(`fallback reserves the installed Anthropic SDK wire output ceiling: ${thinking}`, async () => {
    const budget = fallbackOutputBudget(model, thinking);
    let wireMax: unknown;
    const response = await streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "Classify this result", timestamp: 0 }] }), {
      apiKey: "test-key",
      reasoning: thinking === "off" ? undefined : thinking,
      maxTokens: budget.maxTokens,
      onPayload: payload => {
        wireMax = (payload as { max_tokens: number }).max_tokens;
        // Stop before network access. Exercise actual SDK request conversion.
        throw new Error("test stops before transport");
      },
    }).result();
    assert.equal(response.stopReason, "error");
    assert.equal(wireMax, budget.reservedTokens);
    assert.equal(budget.maxTokens, 2048);
    if (thinking === "high") assert.equal(wireMax, 16384);
    if (thinking === "off") assert.equal(wireMax, 2048);
  });
}

test("output reserves cover Bedrock and retain base caps for adaptive and other APIs", () => {
  assert.equal(fallbackOutputBudget({ ...model, api: "bedrock-converse-stream" } as Model<Api>, "high").reservedTokens, 16384);
  assert.equal(fallbackOutputBudget({ ...model, compat: { forceAdaptiveThinking: true } }, "high").reservedTokens, 2048);
  assert.equal(fallbackOutputBudget({ ...model, api: "openai-completions" }, "high").reservedTokens, 2048);
});
