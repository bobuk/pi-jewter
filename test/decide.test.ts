import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/config.ts";
import {
  NO_ROLE,
  buildJevQuestions,
  decide,
  normalizeScore,
  tierFromScore,
} from "../src/jev/decide.ts";

function response(
  role: string,
  confidence: number,
  score = 0.9,
  scoreConfidence = 0.9,
): Parameters<typeof decide>[0]["response"] {
  return {
    answers: {
      role: { type: "choice", choice: role, confidence, probabilities: { [role]: confidence } },
      complexity: { type: "score", score, confidence: scoreConfidence },
    },
    usage: { input_tokens: 42, output_tokens: 3 },
  };
}

test("switch: confident role with high complexity routes to strong", () => {
  const decision = decide({ response: response("planning", 0.9), config: defaultConfig() });
  assert.equal(decision.action, "switch");
  assert.equal(decision.role, "planning");
  assert.equal(decision.tier, "strong");
  assert.equal(decision.usage?.inputTokens, 42);
});

test("switch: low complexity routes to fast", () => {
  const decision = decide({ response: response("quick", 0.8, 0.1), config: defaultConfig() });
  assert.equal(decision.action, "switch");
  assert.equal(decision.tier, "fast");
});

test("keep: low confidence keeps the current model", () => {
  const decision = decide({ response: response("planning", 0.4), config: defaultConfig() });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "low-confidence");
  assert.equal(decision.role, "planning");
});

test("keep: explicit none role keeps the current model", () => {
  const decision = decide({ response: response(NO_ROLE, 0.95), config: defaultConfig() });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "none-role");
});

test("keep: unknown role keeps the current model", () => {
  const decision = decide({ response: response("gardening", 0.95), config: defaultConfig() });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "unknown-role");
});

test("keep: missing role answer keeps the current model", () => {
  const decision = decide({ response: { answers: {} }, config: defaultConfig() });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "missing-answer");
});

test("keep: disabled config keeps the current model", () => {
  const config = defaultConfig();
  config.jev.enabled = false;
  const decision = decide({ response: response("planning", 0.9), config });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "disabled");
});

test("same role and tier keeps the model when configured", () => {
  const decision = decide({
    response: response("planning", 0.9),
    config: defaultConfig(),
    currentRole: "planning",
    currentTier: "strong",
  });
  assert.equal(decision.action, "keep");
  assert.equal(decision.keepReason, "same");
});

test("confident role with missing complexity selects the medium tier", () => {
  const decision = decide({
    response: { answers: { role: { type: "choice", choice: "quick", confidence: 0.9, probabilities: {} } } },
    config: defaultConfig(),
  });
  assert.equal(decision.action, "switch");
  assert.equal(decision.tier, "medium");
  assert.equal(decision.tierSource, "fallback-missing");
  assert.equal(decision.scoreConfidence, 0);
});

test("confident review with uncertain complexity switches to review medium", () => {
  const decision = decide({ response: response("review", 1, 1.3, 0.52), config: defaultConfig() });
  assert.equal(decision.action, "switch");
  assert.equal(decision.role, "review");
  assert.equal(decision.tier, "medium");
  assert.equal(decision.tierSource, "fallback-low-confidence");
  assert.equal(decision.scoreConfidence, 0.52);
});

test("score legend defines 0..2 scale even when score is below 1", () => {
  const result = response("review", 1, 0.9, 0.9);
  Object.assign(result.answers.complexity!, { legend: { "0": "trivial", "1": "moderate", "2": "complex" } });
  const decision = decide({ response: result, config: defaultConfig() });
  assert.equal(decision.score, 0.45);
  assert.equal(decision.tier, "medium");
  assert.equal(decision.tierSource, "jev");
});

test("normalizeScore maps level indices to 0..1 and clamps", () => {
  assert.equal(normalizeScore(0, 2), 0);
  assert.equal(normalizeScore(0.5, 2), 0.5);
  // A literal 1 is read as the normalized maximum (hardest), like pi-jev does.
  assert.equal(normalizeScore(1, 2), 1);
  assert.equal(normalizeScore(2, 2), 1);
  assert.equal(normalizeScore(-1, 2), 0);
});

test("tierFromScore honors custom thresholds", () => {
  assert.equal(tierFromScore(0.2, 0.34, 0.67), "fast");
  assert.equal(tierFromScore(0.5, 0.34, 0.67), "medium");
  assert.equal(tierFromScore(0.9, 0.34, 0.67), "strong");
  assert.equal(tierFromScore(0.5, 0.6, 0.8), "fast");
  assert.equal(tierFromScore(0.7, 0.6, 0.8), "medium");
});

test("buildJevQuestions includes every configured role and the none option", () => {
  const questions = buildJevQuestions(defaultConfig());
  const criteria = questions.role?.criteria ?? {};
  for (const role of Object.keys(defaultConfig().roles)) assert.ok(role in criteria, role);
  assert.ok(NO_ROLE in criteria);
  assert.equal(questions.complexity?.type, "score");
});

test("complexity question rates needed capability, not prompt size", () => {
  const q = buildJevQuestions(defaultConfig()).complexity!;
  assert.match(q.instructions ?? "", /not how long the prompt is or how many files it touches/);
  assert.match(q.instructions ?? "", /large repetitive/);
  assert.match(q.instructions ?? "", /high stakes/);
  assert.doesNotMatch(q.instructions ?? "", /multi-file changes/);
});

test("verification is offered to Jev as its own role, separate from implementation", () => {
  const criteria = buildJevQuestions(defaultConfig()).role!.criteria as Record<string, string>;
  assert.match(criteria.verification ?? "", /tests/);
  assert.doesNotMatch(criteria.implementation ?? "", /verif|tests/);
});
