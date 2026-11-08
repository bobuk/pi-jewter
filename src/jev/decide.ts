import { TIER_NAMES, type JewterConfig, type TierName } from "../config.ts";
import type { JevAnswer, JevQuestions, JevResponse } from "./types.ts";

export const ROLE_QUESTION = "role";
export const COMPLEXITY_QUESTION = "complexity";
/** Chosen when no configured role fits the request. */
export const NO_ROLE = "none";

export type KeepReason =
  | "disabled"
  | "missing-answer"
  | "low-confidence"
  | "none-role"
  | "unknown-role"
  | "same";

export interface Decision {
  action: "switch" | "keep";
  keepReason?: KeepReason;
  /** Classified role, present when the role answer was usable. */
  role?: string;
  tier: TierName;
  /** Normalized complexity score in 0..1. */
  score: number;
  scoreConfidence: number;
  /** Why this tier was selected, independent of role confidence. */
  tierSource: "jev" | "jev-majority" | "fallback-missing" | "fallback-low-confidence";
  roleConfidence: number;
  probabilities: Record<string, number>;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * Complexity measures the capability a request needs, not its size: a short
 * "deploy and harden" is complex, a rename across 200 files is trivial.
 * Thoroughness is a separate axis, expressed through role thinking levels.
 */
export const COMPLEXITY_INSTRUCTIONS =
  "Rate how much capability the work requested in `prompt` needs. Judge the knowledge, judgement and " +
  "risk involved, not how long the prompt is or how many files it touches. " +
  "Level 0 is trivial: lookups, questions about code already in context, precise mechanical edits, " +
  "including large repetitive ones. Level 1 is moderate: ordinary feature work or bug fixes with a clear approach. " +
  "Level 2 is complex: subtle or unreproduced bugs, unfamiliar domains, architecture decisions, ambiguous goals, " +
  "and short requests with high stakes such as deploying, securing, or migrating production systems.";

/** Build the two Jev questions from the configured roles. */
export function buildJevQuestions(config: JewterConfig): JevQuestions {
  const criteria: Record<string, string | null> = {};
  for (const [id, role] of Object.entries(config.roles)) {
    criteria[id] = role.description ?? id;
  }
  criteria[NO_ROLE] = "No specific role fits: greetings, vague requests, or work that does not need a different model";
  return {
    [ROLE_QUESTION]: {
      type: "choice",
      instructions:
        "Pick the role that best matches the work requested in `prompt` for a coding assistant. " +
        "Use `previous_exchange`, when present, only to understand references such as \"this plan\" or \"do it\". " +
        "Choose `none` when no specific role is a clear match.",
      criteria,
    },
    [COMPLEXITY_QUESTION]: {
      type: "score",
      instructions: COMPLEXITY_INSTRUCTIONS,
      criteria: ["trivial", "moderate", "complex"],
    },
  };
}

/** Jev state sent with the classification request. */
export function buildJevState(prompt: string, currentRole?: string, previous?: string): Record<string, unknown> {
  return {
    prompt: prompt.slice(0, 16_000),
    ...(currentRole ? { current_role: currentRole } : {}),
    // Only to resolve references like "implement this plan"; the role is decided by `prompt`.
    ...(previous ? { previous_exchange: previous } : {}),
  };
}

export interface ParsedChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export function parseChoice(answer: JevAnswer | undefined): ParsedChoice | undefined {
  if (!answer || typeof answer !== "object" || !("choice" in answer) || typeof answer.choice !== "string") {
    return undefined;
  }
  const confidence =
    "confidence" in answer && typeof answer.confidence === "number" ? answer.confidence : 0;
  const probabilities =
    "probabilities" in answer && answer.probabilities && typeof answer.probabilities === "object"
      ? (answer.probabilities as Record<string, number>)
      : {};
  return { choice: answer.choice, confidence, probabilities };
}

export interface ParsedScore {
  score: number;
  confidence: number;
  /** Numeric bounds of the advertised score legend, when present. */
  range?: { min: number; max: number };
  /** Per-level probabilities keyed by numeric level, when present. */
  levels?: Record<number, number>;
}

export function parseScore(answer: JevAnswer | undefined): ParsedScore | undefined {
  if (!answer || typeof answer !== "object" || !("score" in answer) || typeof answer.score !== "number") {
    return undefined;
  }
  if (!Number.isFinite(answer.score)) return undefined;
  const confidence =
    "confidence" in answer && typeof answer.confidence === "number" ? answer.confidence : 0;
  const legend = "legend" in answer ? answer.legend : undefined;
  const keys = legend && typeof legend === "object" && !Array.isArray(legend)
    ? Object.keys(legend).filter(key => key.trim() !== "").map(Number).filter(Number.isFinite)
    : [];
  const min = Math.min(...keys);
  const max = Math.max(...keys);
  const raw = "probabilities" in answer ? answer.probabilities : undefined;
  const levels: Record<number, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const level = Number(key);
      if (key.trim() !== "" && Number.isFinite(level) && typeof value === "number" && Number.isFinite(value)) levels[level] = value;
    }
  }
  return {
    score: answer.score,
    confidence,
    ...(keys.length >= 2 && max > min ? { range: { min, max } } : {}),
    ...(Object.keys(levels).length >= 2 ? { levels } : {}),
  };
}

/** Normalize a raw Jev score into 0..1; raw scores above 1 are level indices. */
export function normalizeScore(score: number, span: number): number {
  const normalized = score <= 1 ? score : score / span;
  return Math.min(1, Math.max(0, normalized));
}

export function tierFromScore(score: number, fastMax: number, strongMin: number): TierName {
  if (score <= fastMax) return "fast";
  if (score >= strongMin) return "strong";
  return "medium";
}

export interface DecideInput {
  response: JevResponse;
  config: JewterConfig;
  /** Role of the model currently in use, when known. */
  currentRole?: string;
  /** Tier currently in use, when known. */
  currentTier?: TierName;
}

/**
 * Pure routing policy: turn Jev answers into a switch/keep decision.
 *
 * The router resolves the physical model from the decision; a `keep` leaves
 * the current model untouched.
 */
export function decide(input: DecideInput): Decision {
  const { response, config, currentRole, currentTier } = input;
  const base = {
    tier: "medium" as TierName,
    score: 0.5,
    scoreConfidence: 0,
    tierSource: "fallback-missing" as const,
    roleConfidence: 0,
    probabilities: {} as Record<string, number>,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };

  if (!config.jev.enabled || !config.enabled) {
    return { ...base, action: "keep", keepReason: "disabled" };
  }

  const role = parseChoice(response.answers[ROLE_QUESTION]);
  if (!role) return { ...base, action: "keep", keepReason: "missing-answer" };

  const withRole = {
    ...base,
    role: role.choice,
    roleConfidence: role.confidence,
    probabilities: role.probabilities,
  };

  if (!Number.isFinite(role.confidence) || role.confidence < config.jev.minConfidence || role.confidence > 1) {
    return { ...withRole, action: "keep", keepReason: "low-confidence" };
  }
  if (role.choice === NO_ROLE) {
    return { ...withRole, action: "keep", keepReason: "none-role" };
  }
  if (!(role.choice in config.roles)) {
    return { ...withRole, action: "keep", keepReason: "unknown-role" };
  }

  const parsedScore = parseScore(response.answers[COMPLEXITY_QUESTION]);
  const confidence = parsedScore?.confidence ?? 0;
  const confident = parsedScore && Number.isFinite(confidence) && confidence >= config.jev.minConfidence && confidence <= 1;
  const range = parsedScore?.range ?? { min: 0, max: TIER_NAMES.length - 1 };
  const toUnit = (value: number) => Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
  const score = parsedScore
    ? parsedScore.range ? toUnit(parsedScore.score) : normalizeScore(parsedScore.score, TIER_NAMES.length - 1)
    : 0.5;
  // With a flat distribution, a clear majority level is still a usable signal.
  const majority = !confident && parsedScore?.levels
    ? Object.entries(parsedScore.levels).sort((a, b) => b[1] - a[1])[0]
    : undefined;
  const useMajority = majority !== undefined && majority[1] >= config.jev.tierMajority;
  const tier = confident
    ? tierFromScore(score, config.jev.fastMax, config.jev.strongMin)
    : useMajority ? tierFromScore(toUnit(Number(majority[0])), config.jev.fastMax, config.jev.strongMin) : "medium";
  const tierSource: Decision["tierSource"] = !parsedScore
    ? "fallback-missing"
    : confident ? "jev" : useMajority ? "jev-majority" : "fallback-low-confidence";
  const withScore = { ...withRole, tier, score, scoreConfidence: Number.isFinite(confidence) ? confidence : 0, tierSource };

  if (config.routing.keepSameRole && currentRole === role.choice && currentTier === tier) {
    return { ...withScore, action: "keep", keepReason: "same" };
  }

  return { ...withScore, action: "switch" };
}
