# pi-jewter

[![npm](https://img.shields.io/npm/v/pi-jewter)](https://www.npmjs.com/package/pi-jewter) [![license](https://img.shields.io/npm/l/pi-jewter)](LICENSE)

Role- and tier-aware model routing for [Pi](https://pi.dev), powered by [Jev](https://typesafe.ai) (TypeSafe System One).

The virtual model `jewter/auto` classifies each user turn into a **role** and a **tier**, then routes the request to a physical model you configured. Roles are yours: `planning`, `implementation`, `review`, `research`, `quick` ship as defaults, each inheriting the global `fast`/`medium`/`strong` tiers and free to override them. Every decision is visible — footer status, transcript cards, a per-request model receipt — and nothing is hidden behind the router.

- **Roles on top of tiers** — planning can use one model family while implementation and review use others, per tier.
- **Jev decides, you stay in control** — low confidence, `none`, unknown roles, classifier errors and missing model credentials all keep the current model.
- **Visible receipts** — which physical models answered, with which thinking level, what tools they ran, and what Jev proposed.
- **Subscription-friendly picker** — model selection matches `/model`: fuzzy search, provider badges, and `Tab` scopes for `logins` (ChatGPT/Claude sign-ins) and models already in use.
- **Conversational setup** — one menu entry hands the configuration to a normal assistant turn: it asks, proposes concrete model ids and writes only after you confirm.
- **Opt-in selective compaction** — Jev keeps or shortens large tool results, with an LLM second opinion for uncertain cases and Pi's standard compaction as the safe fallback.
- **Subagent routing** — bind any `pi-subagents` agent to `auto`, to a fallback role, or leave it unchanged.

## Requirements

- Pi **1.5.0 or newer** (tested with 1.5.0).
- Node **22.19.0 or newer** (Pi's own requirement).
- A Jev credential: `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` (transport `auto` prefers TypeSafe).
- Physical models configured in Pi with working credentials; any provider Pi supports.

## Install

```sh
# from npm
pi install npm:pi-jewter

# from a git checkout
pi install git:github.com/bobuk/pi-jewter

# from a local checkout or a single extension file
pi install /absolute/path/to/pi-jewter
pi -e /absolute/path/to/pi-jewter/src/index.ts
```

Then open `/jewter` (or pick **Configure in a chat with Pi**) and configure at least the default **medium** physical model, ideally `fast` and `strong` as well. Initial sessions have no prior physical model, so a configured, authenticated fallback is required even if Jev is unavailable. On an existing conversation Jewter keeps the last physical model on classifier failure, low confidence, or a `none` classification. If neither previous nor configured fallback exists, routing must fail with an explanatory error: a virtual model cannot itself answer.

Each tier stores a `provider/model` reference and thinking level; models can use any provider available in Pi. Roles inherit default tiers unless overridden. `/jewter` configures default tiers, role descriptions and overrides, transport, notifications and subagent bindings. Model and agent lists open a fuzzy picker like the built-in `/model` selector: type to filter (slashes and spaces act as token separators), arrows move, enter selects, escape clears the query first. Each entry shows the plain model id first with a `[provider]` badge, context window and reasoning support; the current model is pinned on top and marked `current`, and the highlighted row is always spelled out in full. `Tab` switches scope, like `/model`: `all`, `logins` (models behind a subscription sign-in such as `openai-codex`, and Claude via login when configured) and `used` (models already referenced by the current configuration); scopes with no entries are hidden. When you leave a submenu, the root menu returns to the item you came from instead of jumping to the first row. Changes apply to subsequent requests. Role models are registered dynamically; `/reload` may be needed for a fresh model picker.

Role and complexity confidence are evaluated separately. If the role is clear but complexity confidence is low, a level holding at least `jev.tierMajority` (default 0.5) of the probability still picks its tier (`tier: majority` in the footer); otherwise the role's `medium` tier is used (`tier: default`). Jev also receives a bounded excerpt of the previous exchange, so follow-ups such as "implement this plan" are classified in context. When the router keeps the current model, the footer still shows what Jev answered and why it was not applied. Project roles are registered at startup, so `--model jewter/<project-role>` resolves; their settings apply only in trusted projects. Low-confidence or unknown roles still leave the current model unchanged. When Jev provides a numeric score legend, its range is used for tier normalization.

Jev transport defaults to `auto`: `TYPESAFE_API_KEY` if present, else `OPENROUTER_API_KEY`. Select `typesafe` or `openrouter` explicitly in the menu. Optional overrides `JEWTER_API_KEY`, `JEWTER_JEV_MODEL`, `JEWTER_JEV_BASE_URL`, `JEWTER_TRANSPORT`, `JEWTER_DISABLED`, `JEWTER_NOTIFY`. Keys stay in the environment, never in settings. OpenRouter's decisions endpoint is alpha. Jev receives up to 16,000 characters of the current user prompt and the current role; it does not receive tool output or full history. Classification adds latency and may incur charges.

## Commands and visibility

- `/jewter` — settings menu. Every row shows its current value; `Tab` switches between global and trusted-project settings, and leaving a submenu returns to the row you came from:
  - **Configure in a chat with Pi** — conversational setup (see below).
  - **Models** — one table for the default tiers and every role; inherited tiers are shown in parentheses. Pick a row to set a tier model and thinking level, or edit, rename and delete roles; `+ New role` adds one.
  - **Subagents** — agents routed through Jewter first, each with its binding; bindings for agents without a definition are flagged.
  - **Compaction** — on/off, fallback model and thinking.
  - **Display** — switch notifications, footer status, routing cards, model report.
  - **Advanced** — routing on/off, Jev transport/model/endpoint/timeout, routing and compaction thresholds.
- `/jewter status`, `/jewter why`, `/jewter log [n]` — inspect decisions on the current branch.
- `/jewter route <text>` — classify without switching model.
- `/jewter on|off` — toggle globally.
- **Configure in a chat with Pi** in the menu closes it and starts a normal assistant turn that configures Jewter conversationally: the agent reads the config, lists available models with `pi --list-models`, proposes concrete `provider/id` choices, asks before writing anything, and reminds you to `/reload`. It uses the current session model and the regular tools, so the dialog itself is visible in the transcript.

The footer shows the latest decision, selected model, confidence and latency. Cards in the session transcript retain detail; expand to see probabilities. Model switches notify by default in the main session; child notifications can be enabled in **Display**. Pi records the actual physical model on each assistant message.

### Report after every request

A **Models** receipt appears in the chat after the run has fully finished (including retries and automatic continuations). It is enabled by default and can be toggled in `/jewter` → **Display** → **Model report** (`ui.report: false` in config). This is independent of `ui.cards`, which controls individual routing cards.

The receipt lists the **physical model IDs reported in assistant messages**, thinking levels, applied roles, executed tools and request counts, plus a one-line `Jewter: <role>/<tier>` summary. Jev is not listed: it classifies but does not work on the request. Only Jewter's own compaction fallback LLM calls appear as a separate line. Failed and aborted attempts stay visible. Counts describe observed tool calls, not claims that edits or tests were correct. The classifier's proposed route is never substituted for actual model use. Subagents have their own session receipts; the parent reports delegation tool calls but does not guess which physical models a child used. Native Pi compaction and calls made internally by other extensions are not attributed to invented models.

The report is a persisted UI-only entry (`jewter-model-report`), not text sent to the LLM. It makes no additional API calls, does not trigger another answer, and does not change the assistant's answer. In JSON mode, inspect the `entry_appended` record; plain print mode continues to output the assistant's text without an extra report. The report is retained when reopening the session.

## Subagents

In the menu select Subagents, agent, then `auto` or a fallback role. This updates the agent's `model` and adds Jewter to its `subagentOnlyExtensions` in the selected Pi settings file, preserving existing override fields and child-only extensions. Confirm before writing and `/reload` afterwards. `off (leave unchanged)` performs no write; it does not undo an earlier override. Ensure Jewter is loaded in each child; pi-subagents background and foreground extension-loading policies differ. Test the exact execution mode before relying on it. Other per-run model overrides take precedence.

## Config

Global: `~/.pi/agent/jewter.json`; project: `.pi/jewter.json` only when the project is trusted. Project values overlay global values, environment variables take precedence. Example:

```json
{
  "tiers": {
    "fast": { "model": "openrouter/deepseek/deepseek-v4.1-flash", "thinking": "low" },
    "medium": { "model": "openrouter/openai/gpt-6.1-sol", "thinking": "high" },
    "strong": { "model": "openrouter/anthropic/claude-opus-5.5", "thinking": "high" }
  },
  "roles": {
    "planning": { "description": "Plan and design", "tiers": { "medium": { "model": "openrouter/anthropic/claude-opus-5.5", "thinking": "high" } } }
  },
  "jev": { "transport": "auto", "minConfidence": 0.6, "fastMax": 0.34, "strongMin": 0.67, "timeoutMs": 8000 },
  "ui": { "notify": "main" }
}
```

Pi clamps unsupported thinking levels for each physical model. Jev is probabilistic: verify actual routing in the footer/card, and use `/model` for a manual choice. Switching physical models may lose prompt-cache benefits. Failed retries and tool continuations stay on the prior physical model. Disabling Jewter keeps an existing physical model or uses a configured fallback.

## Selective compaction (opt-in)

Open `/jewter` → **Compaction** to enable it, set the minimum Jev confidence and choose a fallback model and thinking level. The fallback model defaults to the global `fast` tier. Jewter's compaction is **off by default**, independently of the routing toggle, so installing or upgrading never silently replaces an existing compactor.

When Pi triggers `/compact` or automatic compaction, Jev classifies large non-error tool results as `keep` or `shorten`. It sees the part being replaced, a bounded excerpt of the recent context Pi keeps after the cut, and the latest user requests, so results are judged against the work that continues. Each result is shown as head plus tail, marked incomplete when the middle is hidden. Decisions below the configured confidence threshold, missing or malformed answers, and confident `shorten` verdicts on partially visible results are sent to the configured physical LLM in one bounded request with wider excerpts. If that model cannot decide, fails, or returns invalid JSON, those results are retained. On a successful `shorten`, Jewter keeps the beginning and the end of the result with an explicit marker for the omitted middle.

Size is measured on everything the session carries: previous summary plus replaced span before, full summary after. If the result exceeds `maxSummaryChars` (default 60 000) or misses `minReduction`, Pi's standard compaction runs instead and re-summarizes the earlier summary too, so summaries cannot grow without bound. The notification states the reason. It preserves user and assistant text, tool calls, previous summaries, error results and the last result at a cut boundary. The newest retained context remains under Pi's control. Custom `/compact` instructions and unsupported message/image types use Pi's standard compaction instead; so do Jev failures, aborts and insufficient reduction.

Jev and the fallback LLM receive excerpts of the conversation and tool output, which may contain sensitive data; the fallback is a separate potentially paid API call. Status appears while running, followed by a notification with counts and reduction. Successful compaction entries carry `details.engine: "jewter"` and decision statistics. LLM usage is recorded when Pi accepts the custom compaction; Jev usage is not currently included in Pi's session cost. A keep-or-shorten decision is probabilistic, not a guarantee that omitted text was unimportant. Test against representative sessions before relying on it.

Example configuration (global `~/.pi/agent/jewter.json` or trusted project `.pi/jewter.json`):

```json
{
  "compaction": {
    "enabled": true,
    "model": "openrouter/deepseek/deepseek-v4.1-flash",
    "thinking": "off",
    "minConfidence": 0.8,
    "minReduction": 0.15,
    "minResultChars": 1200,
    "retainedChars": 400,
    "maxCandidates": 40,
    "maxSummaryChars": 60000,
    "timeoutMs": 15000
  }
}
```

Omit `model` to follow the configured default `fast` tier; `auto` thinking uses `low`. The caller can cancel compaction. If no previous physical model exists for routing and no tier is configured, configure one before using the virtual model.

## Transition from pi-jev

Jewter does **not** uninstall or alter `@alexlikevibe/pi-jev`. Disable its routing extension while using Jewter routing, and disable its compaction extension **before enabling Jewter compaction**; do not run two competing compaction hooks. After testing, remove pi-jev yourself if desired.

## Design notes and limitations

- Jev receives the current user prompt (bounded to 16,000 characters), the current role, and a bounded excerpt of the previous exchange. It does not receive tool output or the full conversation for routing.
- Routing is probabilistic. The footer and the **Models** receipt always show the actual physical model that answered and what Jev proposed; use `/model` to pick a model manually.
- Switching physical models can lose prompt-cache benefits; tool continuations and retries stay on the model that answered.
- The OpenRouter decisions endpoint is alpha. Classification adds latency and may incur charges.
- Jewter does not send anything else anywhere: configuration stays on disk, keys stay in the environment (`JEWTER_API_KEY` overrides the selected transport's variable).
- Existing routers (`before_agent_start` model switchers, other model selectors) should be disabled while Jewter routing is active.
- Jewter never replaces Pi's compaction unless you explicitly enable its compaction, and then it falls back to Pi's summarizer whenever a result would be too large, too similar, or unsupported.

## Development

```sh
npm install
npm run check   # typecheck + tests
```

The extension loads TypeScript directly, so a checkout can be used without a build step. Tests use Node's built-in test runner and type stripping.

## License

MIT
