# Configuration reference

[README](../README.md) · [Workflows](workflows.md) · [Behavior](behavior.md)

## Files and precedence

Configuration is plain JSON, loaded in this order:

1. Built-in defaults.
2. Global `<Pi agent directory>/jewter.json` (normally `~/.pi/agent/jewter.json`; respects `PI_CODING_AGENT_DIR`).
3. `<project>/.pi/jewter.json`, only when the project is trusted during normal extension use.
4. Supported `JEWTER_*` environment overrides.

Objects merge recursively. Omitted fields retain inherited/default values. Later scalar values replace earlier ones. Invalid JSON produces a warning and that file is ignored. Known fields are normalized; numbers outside supported ranges are clamped. Unknown fields are not used. Back up files before replacing them with a preset.

Project role names may be registered early so `--model jewter/<project-role>` resolves, but their settings only apply in trusted projects. Avoid `auto` and `none` as role IDs. Other IDs must match `[a-z][a-z0-9-]*`.

## Minimal configuration

Use exact `provider/model` IDs from `/model` or `pi --list-models`. This example assumes a working `openai-codex` subscription sign-in and the listed model:

```json
{
  "tiers": {
    "fast": { "model": "openai-codex/gpt-6-luna", "thinking": "low" },
    "medium": { "model": "openai-codex/gpt-6.1-sol", "thinking": "medium" },
    "strong": { "model": "openai-codex/gpt-6.1-sol", "thinking": "high" }
  },
  "jev": { "transport": "auto" }
}
```

Assigning the same model to multiple tiers is valid. Tier names describe your policy, not a measured ranking: Jewter does not benchmark the assignments. A more capable model on `strong` is a choice you make, not something the router verifies.

## Model and thinking inheritance

Each `tiers.<fast|medium|strong>` accepts:

| Field | Default | Meaning |
| --- | --- | --- |
| `model` | Unset | Physical `provider/model` reference; never another `jewter/*` model |
| `thinking` | `auto` | `auto`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

Role `model` and `thinking` resolve **independently**: role override → global tier → `auto` for thinking. Pi clamps unsupported thinking levels on the chosen model. Jewter's thinking settings are Pi abstractions: their provider-specific meaning is not guaranteed to match Claude Code's effort settings.

`auto` preserves the thinking level selected for the request/session. It does not ask the physical provider for a recommended default. To request a stable baseline, set an explicit supported level such as `medium`.

Example: retain the default medium model but use more thorough verification:

```json
{
  "roles": {
    "verification": {
      "tiers": { "medium": { "thinking": "high" } }
    }
  }
}
```

Built-in roles are `planning`, `implementation`, `verification`, `review`, `research`, `quick`. Each role accepts `description` (sent to Jev as classification guidance) and `tiers` (partial per-tier overrides). Apart from `verification`, built-in roles have no tier overrides. `verification` supplies only thinking: `fast: medium`, `medium: high`, `strong: high`.

To add a role or remove one, for example:

```json
{
  "roles": {
    "documentation": {
      "description": "Writing and editing technical documentation",
      "tiers": { "medium": { "thinking": "low" } }
    },
    "research": null
  }
}
```

To clear a model/thinking override, set its field to `null` or `""`. In the menu, **(inherit)** clears both role model and thinking for the selected tier. Built-in thinking-only overrides and other configured values participate in the merge, so explicitly clear the field when you want global thinking instead.

`jewter/<role>` is a **fallback role**, not a role lock. Jev can classify a later request into another role. For a fixed physical model, use Pi's `/model` directly.

## Jev transport and credentials

Jev is a classifier, not the model implementing your request. Its key is needed even if all answering models use subscription logins.

| Transport | Environment key | Default model | Default endpoint |
| --- | --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` | `jev-latest` | `https://api.typesafe.ai/v1/systemone` |
| `openrouter` | `OPENROUTER_API_KEY` | `typesafe/jev-1.13` | `https://openrouter.ai/api/alpha/decisions` |

The OpenRouter decisions endpoint is alpha. Under `auto`, TypeSafe is preferred when `TYPESAFE_API_KEY` or `JEWTER_API_KEY` is present; otherwise OpenRouter is selected when `OPENROUTER_API_KEY` exists. `JEWTER_API_KEY` overrides the credential for the selected transport. If using it with OpenRouter, explicitly choose `transport: "openrouter"` or set `JEWTER_TRANSPORT=openrouter`.

| `jev` field | Default | Range / behavior |
| --- | --- | --- |
| `transport` | `auto` | `auto`, `typesafe`, `openrouter` |
| `model` | Transport default | Override classifier model ID, not the answering model |
| `baseUrl` | Transport default | Override classifier endpoint; use a trusted endpoint |
| `timeoutMs` | `8000` | 500–120000 ms per Jev request |
| `minConfidence` | `0.6` | 0–1; role confidence gate, also used for complexity confidence |
| `fastMax` | `0.34` | 0–1; normalized complexity ≤ this selects `fast` |
| `strongMin` | `0.67` | 0–1; normalized complexity ≥ this selects `strong` |
| `tierMajority` | `0.5` | 0.34–1; majority-level fallback for uncertain complexity |
| `enabled` | `true` | Disable routing classification and verification hints, not independently enabled compaction |

If `fastMax > strongMin`, normalization lowers `fastMax` to `strongMin` and emits a warning. See [routing behavior](behavior.md#routing) for how missing or uncertain answers are handled.

### Environment overrides

| Variable | Meaning |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe credential |
| `OPENROUTER_API_KEY` | OpenRouter credential |
| `JEWTER_API_KEY` | Override key for the selected Jev transport |
| `JEWTER_TRANSPORT` | Override `jev.transport` |
| `JEWTER_JEV_MODEL` | Override `jev.model` |
| `JEWTER_JEV_BASE_URL` | Override `jev.baseUrl` |
| `JEWTER_DISABLED` | Boolean inverse of top-level `enabled` |
| `JEWTER_NOTIFY` | Override `ui.notify`: `main`, `all`, `off` |

Boolean-like values accept `true/false`, `1/0`, `yes/no`, `on/off`. Store credentials in the environment, not in `jewter.json`. These variables do not replace physical model authentication.

## Routing switches

| Field | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Routing and verification hints toggle; compaction remains independent |
| `routing.keepSameRole` | `true` | Marks a matching current role **and tier** as unchanged; physical model/thinking are still re-resolved against current config |
| `routing.sticky` | `true` | Present in config; currently not consulted by the virtual router. Continuations/retries keep the prior model regardless of this value |

`/jewter on|off` writes the global `enabled` value; trusted-project config and environment can still override it. Turning routing off does not disable the virtual model: it keeps the prior physical model or uses a configured fallback.

## Verification hints

| `verify` field | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Ask Jev after eligible main-session runs with observed changes |
| `minConfidence` | `0.8` | 0.5–1; minimum confidence in `suggest` |

For more suggestions, lower the threshold deliberately:

```json
{ "verify": { "enabled": true, "minConfidence": 0.7 } }
```

This is a preference, not a guarantee of accuracy. `0.7` is **not** the built-in default. Turn off hints in `/jewter` → **Display**; change their confidence under **Advanced**. Hints can run even if you selected a physical model, as long as the routing toggles are enabled. They never submit a user request automatically. See [evidence and limitations](behavior.md#verification-hints).

## Display

| `ui` field | Default | Effect |
| --- | --- | --- |
| `notify` | `main` | Model-switch notifications: `main` (main session), `all` (including children), `off` |
| `footer` | `true` | Latest routing status in footer |
| `cards` | `true` | Visible per-route transcript cards |
| `report` | `true` | Per-request **Models** receipt, independent of `cards` |

`ui.notify: off` only affects switch notifications. It is not a global mute for menus, compaction or verification hints. Disable those features or their display settings separately.

## Selective compaction

Compaction is **off by default**, independent of `enabled` and `jev.enabled`. Enabling it adds a custom handler for Pi's manual/automatic compaction boundaries, not another background compaction schedule.

| `compaction` field | Default | Range / meaning |
| --- | --- | --- |
| `enabled` | `false` | Opt in to Jewter compaction |
| `model` | Global `fast` model | Physical fallback LLM; `null`/empty clears explicit model |
| `thinking` | `off` | Same levels as tiers; here `auto` means `low` |
| `minConfidence` | `0.8` | 0.5–1; Jev keep/shorten confidence gate |
| `minReduction` | `0.15` | 0–1; minimum reduction in serialized characters |
| `minResultChars` | `1200` | 400–100000; minimum tool-result size for consideration |
| `retainedChars` | `400` | 100–10000; target excerpt length retained for shortened results |
| `maxCandidates` | `40` | 1–100; maximum results classified per compaction |
| `maxSummaryChars` | `60000` | 4000–1000000; maximum custom summary size |
| `timeoutMs` | `15000` | 500–120000 ms; fallback LLM timeout; Jev uses `jev.timeoutMs` |

See [compaction behavior](behavior.md#selective-compaction) for preservation and fallback rules. Disable other custom compaction extensions before enabling this one.

## Subagents

Use `/jewter` → **Subagents** to configure actual `pi-subagents` routing. After confirmation, the menu writes to the selected Pi **settings.json**, not `jewter.json`:

```json
{
  "subagents": {
    "agentOverrides": {
      "worker": {
        "model": "jewter/implementation",
        "subagentOnlyExtensions": ["/absolute/installed/path/to/pi-jewter/src/index.ts"]
      }
    }
  }
}
```

The menu inserts the real installed Jewter path, preserves other override fields and merges child-only extensions. If a child uses a custom provider such as `claude-bridge`, ensure its provider extension is loaded in that child too. Paths are machine/install-specific; do not distribute your own absolute paths as a portable preset.

The accepted `jewter.json` field `subagents.agents.<name> = "auto" | "off" | "<role>"` is **not an automatic installer of agent overrides**. Writing it alone does not change child model selection. The menu reads and writes the effective bindings in Pi settings. `off (leave unchanged)` does not undo an existing binding: remove or replace that override in Pi settings yourself.

See [subagent workflow](workflows.md#subagents) for loading policies and limitations.
