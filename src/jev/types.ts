/** Jev (TypeSafe System One) request/response types shared by client and policy. */

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export interface JevChoiceAnswer {
  type?: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevScoreAnswer {
  type?: "score";
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevNoulAnswer {
  type?: "noul";
  noul: number;
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

export interface JevUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface JevResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: JevUsage;
  [key: string]: unknown;
}

/** One Jev HTTP transport: endpoint, default model and credential variable. */
export interface JevTransport {
  id: "typesafe" | "openrouter";
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  envKey: string;
}

export const JEV_TRANSPORTS: Record<"typesafe" | "openrouter", JevTransport> = {
  typesafe: {
    id: "typesafe",
    label: "TypeSafe",
    defaultBaseUrl: "https://api.typesafe.ai/v1/systemone",
    defaultModel: "jev-latest",
    envKey: "TYPESAFE_API_KEY",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/alpha/decisions",
    defaultModel: "typesafe/jev-1.13",
    envKey: "OPENROUTER_API_KEY",
  },
};
