import type { JevQuestions, JevResponse } from "../jev/types.ts";
import { parseChoice } from "../jev/decide.ts";

export const VERIFY_QUESTION = "verify";

/** Facts observed during one run; nothing here is a model's claim about its own work. */
export interface RunFacts {
  prompt: string;
  /** Role Jewter applied to the run, when it routed it. */
  role?: string;
  /** Paths passed to file-changing tools, in first-seen order. */
  changedFiles: string[];
  /** Number of file-changing tool calls, including those without a readable path. */
  edits: number;
  /** Shell commands with their outcome, in order. */
  commands: { command: string; ok: boolean }[];
  toolErrors: number;
  /** Final assistant text of the run. */
  finalText: string;
  aborted: boolean;
}

export interface VerifyGate {
  enabled: boolean;
  routingEnabled: boolean;
  child: boolean;
  hasUI: boolean;
}

/** File-changing tools: Pi's edit/write plus common multi-edit variants. */
export function isChangeTool(name: string): boolean {
  return /^(edit|write|multi_?edit|apply_?patch|str_replace\w*)$/i.test(name);
}

export function isShellTool(name: string): boolean {
  return /^(bash|shell|powershell)$/i.test(name);
}

/** Only ask Jev after a finished, interactive main-session run that changed files outside verification. */
export function shouldAsk(facts: RunFacts, gate: VerifyGate): boolean {
  return gate.enabled && gate.routingEnabled && gate.hasUI && !gate.child && !facts.aborted
    && facts.edits > 0 && facts.role !== "verification" && facts.prompt.trim() !== "";
}

export function buildVerifyQuestions(): JevQuestions {
  return {
    [VERIFY_QUESTION]: {
      type: "choice",
      instructions:
        "A coding agent just finished the request in `request` and changed the files in `changed_files`. " +
        "`commands` lists the shell commands it ran afterwards and whether each succeeded; `final_message` is its last reply. " +
        "Decide whether the user should now ask for a separate verification pass. " +
        "Choose `suggest` only when the change carries risk that was not adequately checked. " +
        "Choose `skip` when the change is trivial, or when relevant tests or checks already ran and passed. " +
        "A build, lint, or typecheck alone does not check behavior.",
      criteria: {
        suggest: "Behavior changed or a bug was fixed with edge cases, concurrency, security, data handling, or public interfaces involved, and no test or reproduction of that behavior succeeded afterwards (a build or typecheck alone does not count)",
        skip: "Docs, comments, text, formatting, renames, or other mechanical edits; or relevant tests or checks ran and passed after the change",
      },
    },
  };
}

const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, Math.floor(max * 0.4))}\n[…]\n${text.slice(-Math.floor(max * 0.6))}` : text;

/** Bounded state for Jev: the request, observed changes and commands, and the closing reply. */
export function buildVerifyState(facts: RunFacts): Record<string, unknown> {
  return {
    request: clip(facts.prompt, 4000),
    changed_files: facts.changedFiles.slice(0, 30),
    edit_calls: facts.edits,
    commands: facts.commands.slice(-12).map(c => `${c.ok ? "ok" : "failed"}: ${c.command.slice(0, 200)}`),
    tool_errors: facts.toolErrors,
    final_message: clip(facts.finalText, 1500),
  };
}

export interface VerifyDecision {
  suggest: boolean;
  choice?: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Suggest only on a confident `suggest`; anything missing or uncertain stays silent. */
export function decideVerify(response: JevResponse, minConfidence: number): VerifyDecision {
  const choice = parseChoice(response.answers[VERIFY_QUESTION]);
  if (!choice) return { suggest: false, confidence: 0, probabilities: {} };
  const confident = Number.isFinite(choice.confidence) && choice.confidence >= minConfidence && choice.confidence <= 1;
  return { suggest: confident && choice.choice === "suggest", choice: choice.choice, confidence: choice.confidence, probabilities: choice.probabilities };
}

/** A ready-to-send prompt in the user's script; it names the files so Jev routes it to verification. */
export function suggestionPrompt(facts: RunFacts): string {
  const files = facts.changedFiles.slice(0, 5).map(f => f.split(/[/\\]/).pop()).join(", ");
  const more = facts.changedFiles.length > 5 ? ` (+${facts.changedFiles.length - 5})` : "";
  if (/[Ѐ-ӿ]/.test(facts.prompt)) {
    return `Проверь изменения из прошлого ответа${files ? ` (${files}${more})` : ""}: воспроизведи исходную проблему, если она была, прогони относящиеся к делу тесты и проверь крайние случаи. Напиши, что проверено и что не проходит.`;
  }
  return `Verify the changes from the previous answer${files ? ` (${files}${more})` : ""}: reproduce the original problem if there was one, run the relevant tests, and probe edge cases. Report what you checked and what still fails.`;
}
