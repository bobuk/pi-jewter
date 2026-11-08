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
  /** Paths/files/directories mentioned by other tools likely to change repository state. */
  indirectChanges: string[];
  /** Count of state-changing non-edit tools (shell, patch, custom tools). */
  indirectEdits: number;
  /** Real test executions observed in shell commands, including exit status. */
  tests: { command: string; ok: boolean }[];
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

/** Pi file editors and common patch tools; shell and custom tools are handled separately. */
export function isChangeTool(name: string): boolean {
  return /^(edit|write|multi_?edit|apply_?patch|str_replace\w*)$/i.test(name);
}

/** Conservative recognizer for commands whose successful completion proves tests ran. */
export function isTestCommand(command: string): boolean {
  return /(?:^|[;&|]\s*|\b)(?:npm\s+(?:run\s+)?(?:test|check|vitest|jest|mocha|playwright|cypress)|pnpm\s+(?:run\s+)?(?:test|check|vitest|jest|mocha|playwright|cypress)|yarn\s+(?:test|check|vitest|jest|mocha|playwright|cypress)|bun\s+(?:run\s+)?(?:test|check)|node\s+--test|pytest\b|uv\s+run\s+pytest\b|cargo\s+test\b|go\s+test\b|dotnet\s+test\b|swift\s+test\b|mix\s+test\b|rspec\b|phpunit\b|\b(?:vitest|jest|mocha|playwright|cypress)\b)/i.test(command);
}

/** Commands that may alter tracked or generated repository content. */
export function isPotentiallyMutatingCommand(command: string): boolean {
  return /(?:^|[;&|]\s*|\b)(?:git\s+(?:apply|checkout|reset|restore|clean|rebase|cherry-pick)|patch\b|sed\s+-i\b|perl\s+-i\b|tee\s+|(?:npm|pnpm|yarn|bun)\s+(?:version|pkg\s+set)|(?:npx|pnpm\s+dlx|bunx)\s+(?:patch-package|prettier|eslint|biome|prisma|drizzle-kit)|(?:cargo|go|swift|protoc)\s+(?:fmt|generate)|make\s+(?:generate|format|fmt)|\w*(?:codegen|generate|scaffold|format|fmt|fix|migrate)\w*\s)/i.test(command);
}

/** Directory-changing/custom tools that are not Pi edit/write calls. */
export function isPotentiallyMutatingTool(name: string): boolean {
  return /^(?:bash|shell|powershell|terminal|filesystem_write|file_write|write_file|edit_file|apply_patch|patch|apply_diff|search_replace|str_replace|multi_edit)$/i.test(name)
    || /(?:write|edit|patch|apply.?diff|replace|generate|scaffold|migrate|format|fix)/i.test(name);
}

export function isShellTool(name: string): boolean {
  return /^(bash|shell|powershell)$/i.test(name);
}

/** Only ask Jev after a finished, interactive main-session run that changed files outside verification. */
export function shouldAsk(facts: RunFacts, gate: VerifyGate): boolean {
  return gate.enabled && gate.routingEnabled && gate.hasUI && !gate.child && !facts.aborted
    && (facts.edits + facts.indirectEdits) > 0 && facts.role !== "verification" && facts.prompt.trim() !== "";
}

export function buildVerifyQuestions(): JevQuestions {
  return {
    [VERIFY_QUESTION]: {
      type: "choice",
      instructions:
        "A coding agent just finished the request in `request` and changed the files in `changed_files`. " +
        "`commands` lists shell commands and their outcomes; `tests` lists recognized test executions and their outcomes; " +
        "`indirect_changes` lists files changed via shell, patch or other non-editor tools. `final_message` is its last reply. " +
        "Decide whether the user should now ask for a separate verification pass. " +
        "Choose `suggest` only when the change carries risk that was not adequately checked. " +
        "Choose `skip` when the change is trivial, or when relevant tests or checks already ran and passed. " +
        "A build, lint, or typecheck alone does not check behavior. Count a test as adequate only if it is relevant to the changed behavior and it passed; test command recognition is evidence it ran, not proof its assertions cover the fix. " +
        "When evidence is unclear, lean toward suggesting verification for risky changes, but skip mechanical edits.",
      criteria: {
        suggest: "Behavior changed or a bug was fixed with edge cases, concurrency, security, data handling, or public interfaces involved, and no relevant test or reproduction of that behavior passed afterwards (a build or typecheck alone does not count)",
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
    changed_files: [...new Set([...facts.changedFiles, ...facts.indirectChanges])].slice(0, 40),
    indirect_changes: facts.indirectChanges.slice(0, 20),
    edit_calls: facts.edits,
    indirect_edit_calls: facts.indirectEdits,
    tests: facts.tests.slice(-12).map(c => `${c.ok ? "passed" : "failed"}: ${c.command.slice(0, 200)}`),
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
