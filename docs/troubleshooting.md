# Troubleshooting

[README](../README.md) · [Configuration](configuration.md) · [Behavior](behavior.md)

## Jewter is missing from `/model` or `/jewter` is unknown

1. Run `pi list` and check that the intended package source is installed.
2. `/reload`, or restart Pi and inspect extension-loading errors.
3. Do not install/load npm, Git and local copies simultaneously.
4. Confirm Pi 1.5.0+ and Node 22.19.0+.

A new role can require `/reload` before it appears in model selection. Project settings only apply in a trusted project.

### Offline loader regression check (source checkout)

After `npm ci --ignore-scripts`, `npm run check` includes a smoke test using Pi's
public `DefaultResourceLoader`. This catches runtime import resolution failures
that direct Node imports can miss. To test a specific installed Pi release:

```sh
PI_LOADER_ENTRY=/path/to/pi-coding-agent/dist/index.js node --experimental-strip-types --test test/extension-loader.test.ts
```

Use the installed package's absolute `dist/index.js` path. The test loads this
checkout's `src/index.ts`, checks command and compaction-hook registration, and
uses a temporary agent directory with in-memory settings. It blocks fetch calls,
makes no model calls, and does not change installed extensions or global settings.
An error containing `pi-ai-extension-view.js/api/simple-options` identifies the
old private-helper import problem; use the fixed source and rerun this check.

## “No previous model and no available fallback”

The router cannot answer by itself. Configure an authenticated physical model in default `medium`, preferably all three tiers. Check exact IDs with `pi --list-models` and working credentials through Pi's normal model setup. Catalog presence alone is not a successful authentication test.

A configured model can be unavailable because its provider is not loaded, its ID changed, it has no credentials, or it points at a virtual model. On an established conversation Jewter can keep a previous physical model; a new conversation cannot assume one exists.

If assistant-led setup cannot start because no physical model is available, select a working physical model first or use the menu to configure tiers.

## Jev credentials or transport errors

Jev needs a separate `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` in Pi's environment. A ChatGPT/Claude sign-in authenticates the answering model, not Jev. Restart the launching shell/app if it did not inherit a newly set variable.

`auto` prefers TypeSafe when its key or `JEWTER_API_KEY` is present. If `JEWTER_API_KEY` is an OpenRouter key, explicitly choose OpenRouter. Inspect `JEWTER_TRANSPORT`, `JEWTER_JEV_MODEL` and `JEWTER_JEV_BASE_URL` if unexpected values persist.

OpenRouter's decisions endpoint is alpha. Transient failure should keep the previous physical model rather than invent a new one. Verification-hint errors are silently ignored; use `/jewter route <text>` to test the transport directly (this is a real, potentially paid call).

## Wrong role or tier

Use `/jewter why` or `/jewter log` to inspect the full routing record, then `/jewter route <explicit request>` to isolate a prompt. Preview does not include the conversation excerpt, so it may differ from a follow-up in chat.

- Low role confidence, `none`, unknown roles or errors keep the previous physical model.
- A clear role with uncertain complexity can use a majority tier or default to `medium`. The footer labels this distinction.
- A short request may still be complex. Many files do not necessarily require a strong model.
- Role descriptions influence Jev. Separate “build it” from “verify it” when a mixed request is ambiguous.

Use `/model` for manual physical selection when the route matters more than automatic convenience. Lower thresholds only after evaluating representative cases; they can increase wrong switches or noisy hints.

## `/jewter off` seems ineffective

`/jewter on|off` writes the **global** routing toggle by default (and warns when `.pi/jewter.json`, `JEWTER_DISABLED`, or `jev.enabled: false` overrides it; pass `/jewter off project` to toggle a trusted project's config). Selecting a `jewter/*` model still needs a physical fallback even while routing is disabled.

Compaction has an independent toggle and may still run. `/model` → physical model bypasses Jewter routing, but does not itself disable verification hints or compaction. `ui.notify: off` only suppresses model-switch notifications, not every Jewter UI action.

## Thinking is not what I expected

`auto` inherits session/request thinking. It is not a provider-default lookup. Role-level thinking overrides global tier thinking; `verification` ships explicit medium/high thinking overrides. Pi clamps unsupported levels for the selected physical model.

Check the **Models** receipt for what assistant messages actually reported. A different model family may interpret a Pi thinking level differently. Clear the role override explicitly if you want to inherit global thinking again.

## Verification hints never appear, or appear unexpectedly

Check **Display** → **Verification hints**, the routing toggles and `verify.minConfidence`. The default confidence is `0.8`; lower it deliberately for more hints. Hints are skipped in detected children, noninteractive contexts, aborted runs, verification-role runs, or runs without recognized successful mutations.

Changes performed by arbitrary shell scripts or opaque tools may not be detected. Conversely, recognized mutation commands may not actually have changed a file. Test-command recognition is also heuristic. See [all evidence limits](behavior.md#verification-hints).

A hint fills only an empty editor. If you were typing, the transcript entry points to `/jewter verify`, which **replaces** the draft when explicitly invoked. It inserts the last branch suggestion even if old: review it before submitting. Automatic insertion never sends a request.

No hint is not proof that tests passed. A hint is not proof they failed. Neither can replace relevant tests and real-world checks.

## Subagent uses another model or cannot load a provider

Named roles are fallbacks, not locks. Jev may switch a child to another role; per-run model overrides can take precedence. Inspect the child's own receipt.

Use the **Subagents** menu, which writes `agentOverrides` into Pi settings. The similarly named map in `jewter.json` alone does not install overrides. Ensure child-only extensions include Jewter and any provider extension it needs. An absolute path copied from another machine or a removed install is invalid.

Test the actual `pi-subagents` execution mode: foreground/background loading policies differ. Choose `off` in `/jewter` → **Subagents** to remove an existing Jewter binding from Pi settings.

## Compaction falls back to Pi

This can be expected: custom instructions, unsupported content, missing credentials, cancellation, Jev failure, inadequate reduction or an oversized custom summary all trigger fallback. Notifications explain the reason. The fallback LLM being unavailable generally retains uncertain results, which can leave too little reduction for custom compaction.

Set a usable fallback LLM or default `fast` model if you enable compaction. Disable competing compaction handlers. Do not lower confidence/reduction safeguards solely to force the custom handler to run.

## The installed version lacks repository features

Read [CHANGELOG.md](../CHANGELOG.md): `Unreleased` entries describe current development, not a published npm release. Update the source you actually installed:

```sh
pi update npm:pi-jewter
# Or, for a Git installation:
pi update git:github.com/bobuk/pi-jewter
```

Then `/reload`. Updating Git does not update the published npm package, and updating an npm installation cannot fetch unreleased Git changes.

## Removing Jewter cleanly

1. Select a physical model for the main session and any scripts/default settings that reference `jewter/*`.
2. Remove or replace Jewter subagent overrides and its child-only extension paths in global/trusted-project Pi settings. Keep unrelated overrides/extensions.
3. `pi remove` the source shown by `pi list`, then `/reload` or restart.
4. Keep your separate `jewter.json` as a backup, or delete it explicitly if desired. Removing the package is not a config reset.

## Reporting a problem

Open an [issue](https://github.com/bobuk/pi-jewter/issues) with Pi/Node versions, package source/version, reproduction steps, expected/actual behavior and sanitized `/jewter why` output. Include child execution mode for subagent issues. Remove credentials, sensitive paths, command arguments and private prompt/tool content before sharing transcripts or configuration.
