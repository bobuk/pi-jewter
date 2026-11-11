import { configPaths } from "../config.ts";

/**
 * Starts a conversational setup turn. The message is visible to the user and to
 * the model as a normal user request, so the agent can inspect the config with
 * its own tools, propose concrete model ids and write files only after consent.
 */
export function setupDialogPrompt(cwd: string): string {
  const paths = configPaths(cwd);
  return [
    "Set up pi-jewter with me in a conversation. Do not write anything until I confirm.",
    "",
    `Config: global ${paths.global}, project ${paths.project} (the project file applies only in a trusted project; project values override global ones).`,
    "First read both files if they exist, and inspect the available models: `pi --list-models` or `pi --list-models <substring>` (for example `codex`, `claude`, `deepseek`).",
    "",
    "Schema (every field is optional):",
    "- tiers.fast | medium | strong = { model: \"provider/id\", thinking: \"auto|off|minimal|low|medium|high|xhigh|max\" }",
    "- roles.<id> = { description, tiers: { <tier>: { model, thinking } } }; a role without its own tiers inherits the global ones",
    "- compaction = { enabled, model, thinking, minConfidence, minReduction, retainedChars, maxSummaryChars }",
    "- subagents.agents.<agent> = \"auto\" | \"off\" | \"<role>\"",
    "- jev = { transport: \"auto|typesafe|openrouter\", model, baseUrl, minConfidence, fastMax, strongMin, tierMajority, timeoutMs }",
    "- routing = { mode: \"request|step\", cachePenalty: 0..1 } (default: step, 0.15; penalty adds confidence required to switch models after tools, not a monetary estimate)",
    "- ui = { notify: \"main|all|off\", footer, cards, report }",
    "- verify = { enabled, minConfidence } (Jev-gated hint to verify a run that changed files; never sent automatically)",
    "",
    "Ask me what to configure: which roles I need (shipped defaults are planning, implementation, verification, review, research, quick), which models to assign to the tiers and roles, whether to enable compaction, and which agents should route through Jewter. Propose concrete provider/id values from the available models and briefly justify the choice. Account for my subscriptions (openai-codex, Claude) and my OpenRouter key.",
    "Guidance: tiers express capability, thinking expresses thoroughness. Keep everyday tiers on medium thinking; use low for quick in-the-loop work, high for verification and review, max only for long unsupervised runs. Put the most capable model on strong and on the planning and review tiers that need judgement, not on routine work. Prefer a different model family for review and verification than for implementation. Profiles to start from: examples/jewter.price.json and examples/jewter.quality.json in the pi-jewter package.",
    "After I confirm, update the config (valid JSON, keep the other fields) and remind me to run /reload.",
  ].join("\n");
}
