# Changelog

## [Unreleased]

- Releases are tagged `vX.Y.Z` in Git, and publishing a GitHub Release publishes the package to npm through trusted publishing (OIDC, with provenance). The release check refuses mismatched tags, missing changelog sections, pre-release mix-ups and versions lower than npm `latest`, and skips versions already on npm. Versions 0.1.0 and 0.2.0 were tagged in Git only and never published to npm.
- Rebuilt the user documentation with a quick start, complete configuration reference, workflows/profiles, evidence and privacy limits, troubleshooting, and development/evaluation guides. Reference docs are included in the npm package.
- Verification hints now distinguish recognized test runs from build/typecheck commands and account for successful shell patch/generator commands and third-party patch/write tools when their effects are observable.
- Jev's complexity question now rates the capability a request needs (knowledge, judgement, risk) instead of prompt length or file count: large mechanical edits are trivial, short high-stakes requests such as deploy or harden are complex.
- New default role `verification` for tests, reproductions, edge cases and validating fixes. It keeps the tier models and raises thinking; `implementation` no longer covers verification.
- `/jewter` Models shows thinking-only role overrides, such as `(sol):high`.
- `examples/jewter.price.json` and `examples/jewter.quality.json` profiles, and a README guide to choosing tiers and thinking.
- Verification hints: after a run that changed files, Jev decides whether a separate verification pass is worth suggesting. Only a confident `suggest` places a ready prompt in an empty editor; nothing is sent automatically. `/jewter verify` re-inserts it; toggle in **Display**, threshold in **Advanced** (`verify.minConfidence`, default 0.8). `npm run eval:verify` checks the decision on labelled runs.
- README: prefer a different model family for review and verification than for implementation, and route spec interviews to `planning`.
- `npm run eval:jev` compares classifier questions on labelled prompts through the live Jev transport (opt-in, paid calls).

## [0.2.0]

- Reorganized `/jewter` into six root entries — Configure in a chat with Pi, Models, Subagents, Compaction, Display, Advanced — with current values shown on every row.
- Models merges default tiers and roles into one table; inherited tiers appear in parentheses.
- `Tab` switches global/project settings; submenus stay open after each change and keep the cursor position.
- Subagents lists bound agents first and flags bindings without an agent definition.

## [0.1.0]

First public release.

- Routing: virtual models `jewter/auto` and `jewter/<role>` classify each user turn with Jev (TypeSafe or OpenRouter) and select a role plus a `fast`/`medium`/`strong` tier.
- Roles inherit the default tiers; every role tier can override model and thinking level. Roles are configurable and registered dynamically.
- Visible decisions: footer status, transcript cards with probabilities, `/jewter status|why|log|route`, and a per-request **Models** receipt showing the physical models, roles, tools and counts.
- Fuzzy model picker like `/model`: id first, `[provider]` badge, current model pinned, and `Tab` scopes `all` / `logins` / `used`.
- Menu `/jewter` with global/trusted-project scope, transport and threshold settings, and a **Configure in a chat with Pi** shortcut that configures Jewter conversationally.
- Subagents: bind an agent to `auto`, a fallback role, or leave it unchanged; Jewter is added to the agent's child-only extensions.
- Opt-in selective compaction: Jev keeps or shortens large tool results with an LLM second opinion for uncertain or partially visible ones, bounded summary growth, and a safe fallback to Pi's standard compaction.
- Failure handling: classifier errors, low confidence and missing answers keep the current model; unsupported context falls back to Pi's compaction.
