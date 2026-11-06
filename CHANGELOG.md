# Changelog

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
