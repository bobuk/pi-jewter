# pi-jewter

[![npm](https://img.shields.io/npm/v/pi-jewter)](https://www.npmjs.com/package/pi-jewter) [![license](https://img.shields.io/npm/l/pi-jewter)](LICENSE)

Role- and tier-aware model routing for [Pi](https://pi.dev), powered by [Jev](https://typesafe.ai).

Select `jewter/auto` once. On each user request, Jev proposes a **role** and a **capability tier**; Jewter resolves those to a physical model and thinking level from your configuration. You see both the decision and the models that actually answered.

Jewter also offers **verification hints** after edits and **opt-in selective compaction**. It does not write specifications, delegate work, run tests, or deploy software by itself.

> This README describes the current repository. Features under [Unreleased in the changelog](CHANGELOG.md#unreleased) are not in any release yet. Use the Git source if you need current `main`.

## Documentation

- [Configuration reference](docs/configuration.md) — defaults, inheritance, credentials, all settings.
- [Workflows and profiles](docs/workflows.md) — capability versus effort, price/quality presets, subagents.
- [Behavior and limits](docs/behavior.md) — routing, verification hints, compaction, privacy and costs.
- [Troubleshooting](docs/troubleshooting.md).
- [Development and evaluation](docs/development.md).
- [Changelog](CHANGELOG.md).

## Install and start

Requires Pi **1.5.0+** (tested with 1.5.0), Node **22.19.0+**, a Jev credential, and at least one authenticated physical model in Pi.

### 1. Install one source

```sh
# Released version from npm
pi install npm:pi-jewter

# Or current main from Git
pi install git:github.com/bobuk/pi-jewter
```

Releases are Git tags `vX.Y.Z` with the same version on npm. If [npm](https://www.npmjs.com/package/pi-jewter) does not list the package yet, install from Git. Run `/reload` if Pi is already open. Do not load the npm, Git and local copies together.

### 2. Provide a Jev credential

Set one variable in the environment that starts Pi:

```sh
export TYPESAFE_API_KEY='…'
# Or:
export OPENROUTER_API_KEY='…'
```

Transport `auto` prefers TypeSafe when its key is present, otherwise OpenRouter. These credentials are **separate** from the credentials used by the models that do your work. Claude or ChatGPT subscription sign-ins do not authenticate Jev. See [transport configuration](docs/configuration.md#jev-transport-and-credentials).

### 3. Configure physical models

Start with a working physical model selected in Pi. Open `/jewter` → **Configure in a chat with Pi**: the assistant reads your settings, inspects `pi --list-models`, proposes concrete model IDs, and asks before writing. Or configure **Models** manually.

Configure at least the default `medium` tier, preferably all three. Jewter ships **no physical model assignments**. In a fresh conversation it cannot fall back to a prior model; a configured, authenticated fallback is required.

Global settings normally live in `~/.pi/agent/jewter.json`. A trusted project's `.pi/jewter.json` overlays them. The global directory follows `PI_CODING_AGENT_DIR` when set.

For a quick starting point, inspect the [price](examples/jewter.price.json) or [quality](examples/jewter.quality.json) example. They need specific providers and model IDs; they are not universal defaults. **Both examples enable compaction**, unlike Jewter's built-in defaults. Review them before merging or copying, and back up your existing configuration.

### 4. Select the router

Use `/model` to select `jewter/auto`, then send a request. `/jewter route <text>` previews classification without changing the answering model.

Use `/model` to choose a physical model whenever you want to bypass automatic model selection. Verification hints and compaction have their own settings; selecting a physical model does not disable those features.

## Roles, tiers and effort

| Role | Intended work |
| --- | --- |
| `planning` | Requirements, specifications, plans and architecture |
| `implementation` | Writing and fixing code; short build-and-iterate loops |
| `verification` | Tests, reproductions, edge cases and validation |
| `review` | Critiquing code, plans or diffs for risks and regressions |
| `research` | Exploration and information gathering |
| `quick` | Small questions, lookups and mechanical edits |

Roles inherit the global `fast`, `medium`, `strong` assignments, with optional per-role overrides. `verification` ships thinking-only overrides: `medium` thinking on `fast`, `high` on the other tiers.

**Model = capability; thinking = thoroughness.** Use capable models where knowledge and judgement matter, not just because a change touches many files. Use lower effort for supervised iteration, higher effort for verification. `thinking: "auto"` passes through the session's selected thinking level; it does **not** discover a provider's recommended default. Pi clamps unsupported levels for each model.

See [workflows](docs/workflows.md) for examples and the limits of cross-model review.

## Commands and menu

| Command | Action |
| --- | --- |
| `/jewter` | Open settings |
| `/jewter status` | Latest routing status on this branch |
| `/jewter why` | Latest full routing record |
| `/jewter log [n]` | Recent routing records (default 10, maximum 50) |
| `/jewter route <text>` | Call Jev and preview a route; no switch |
| `/jewter verify` | Replace the editor contents with the last verification suggestion on this branch; does not send it |
| `/jewter on` / `/jewter off` | Write the global routing toggle |

Menu sections:

- **Configure in a chat with Pi** — visible, assistant-led setup with confirmation before writing.
- **Models** — default tiers, roles, model/thinking overrides, role descriptions, rename/delete, new roles.
- **Subagents** — write `pi-subagents` bindings to Pi settings, with confirmation.
- **Compaction** — opt-in toggle, fallback model and thinking.
- **Display** — switch notifications, footer, routing cards, model receipt, verification hints.
- **Advanced** — routing toggle, Jev transport/model/endpoint/timeout, confidence and tier thresholds, verification confidence, compaction thresholds.

`Tab` switches global/trusted-project settings at the root. Model pickers support fuzzy search and `Tab` scopes: `all`, subscription `logins`, and configured `used` models. Empty scopes are hidden. In role rows `(model)` means inherited; `:high` marks an explicit thinking override.

Most configuration changes apply on subsequent requests. `/reload` is recommended after setup, role changes, package updates and subagent binding changes. A trusted project or environment override can supersede a global menu change.

## Verification hints

Enabled by default, with `verify.minConfidence: 0.8`. After an eligible main-session run with observed edits, Jev assesses whether a separate verification pass would help. A confident `suggest` creates a transcript hint and fills an **empty** editor with a suggested request. **Nothing is sent automatically.** Existing drafts are left alone.

```json
{
  "verify": {
    "enabled": true,
    "minConfidence": 0.7
  }
}
```

`0.7` is a lower-confidence, potentially noisier option, not the package default. Turn hints off in **Display** or set `verify.enabled: false`.

Hints are probabilistic suggestions, **not a verification result**. A silent hint system does not mean the work passed. Read the [evidence and detection limits](docs/behavior.md#verification-hints) before relying on it.

## Visibility, privacy and cost

- Routing cards and the footer show Jev's proposal, selected model, confidence and latency.
- A persisted **Models** receipt reports physical assistant models, thinking, tools and request counts. It is UI-only, costs no extra model call, and is not proof of correctness.
- Routing sends bounded prompt/context excerpts to Jev. Verification sends request, paths, command summaries and the closing reply. Compaction sends conversation/tool-result excerpts to Jev and sometimes a fallback LLM. Any of these can contain sensitive data.
- Classification adds latency and may incur charges. Switching model/provider can lose prompt-cache benefits. Jev calls are not included in Pi's session cost totals.
- Compaction is **off by default**, independently of routing. Do not enable two competing compactors.

See [behavior, costs and privacy](docs/behavior.md) for exact boundaries and failure behavior.

## Update or remove

Use the same source you installed:

```sh
pi update npm:pi-jewter
# Or:
pi update git:github.com/bobuk/pi-jewter
```

Then `/reload`. Updating a Git installation does not publish anything to npm.

To remove:

```sh
pi remove npm:pi-jewter
# Or:
pi remove git:github.com/bobuk/pi-jewter
```

Before removal, select a physical model and remove or replace any subagent `model: "jewter/…"` bindings and Jewter child-only extension paths in Pi settings. The `jewter.json` file is separate from package installation; removal is not a config reset. See [troubleshooting](docs/troubleshooting.md).

## Development

```sh
npm ci --ignore-scripts
npm run check
```

Live, potentially paid evaluations are opt-in and require a source checkout. See [development](docs/development.md).

## License

[MIT](LICENSE)
