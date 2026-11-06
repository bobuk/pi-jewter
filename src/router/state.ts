import type { TierName } from "../config.ts";
import type { Decision } from "../jev/decide.ts";

export interface RouterState {
  role?: string;
  tier?: TierName;
  model?: string;
  decision?: RoutingRecord;
}

export interface RoutingRecord {
  at: string;
  status: "switch" | "keep" | "fallback" | "error" | "dry-run";
  /** Role and tier actually applied to this request. */
  role?: string;
  tier?: TierName;
  /** What Jev answered, even when the router kept the previous model. */
  classifiedRole?: string;
  classifiedTier?: TierName;
  model?: string;
  thinking?: string;
  previousModel?: string;
  reason?: string;
  transport?: string;
  /** Classifier identity from this successful call, not from a later config read. */
  classifierModel?: string;
  elapsedMs: number;
  decision?: Decision;
}
