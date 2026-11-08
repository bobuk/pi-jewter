# Development and evaluation

[README](../README.md) · [Configuration](configuration.md) · [Behavior](behavior.md)

## Local setup

In a repository checkout:

```sh
npm ci --ignore-scripts
npm run check
```

The extension loads TypeScript directly; there is no build step. For development, load a local checkout or a single extension file:

```sh
pi -e /absolute/path/to/pi-jewter/src/index.ts
# Or install the checkout as a package:
pi install /absolute/path/to/pi-jewter
```

Avoid loading it alongside an installed npm/Git copy. Local development is distinct from testing the public install/update path: for that, install a published source in a separate Pi environment with your own credentials/configuration.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Register routing, UI, report, verification and compaction hooks |
| `src/config.ts` | Defaults, file merging, trust gating, normalization, environment overrides |
| `src/jev/` | Transport protocol/client and pure routing policy |
| `src/router/` | Virtual model routing and physical fallback resolution |
| `src/verify/` | Observed run evidence, mutation/test heuristics, Jev hint gate, editor suggestion |
| `src/compaction/` | Selective shortening policy and Pi compaction integration |
| `src/report/` | Physical-model/tool attribution and persisted receipts |
| `src/ui/` | Menus, pickers, routing entries and status |
| `src/commands/` | `/jewter` commands and assistant-led setup prompt |
| `examples/` | Price/quality presets, packaged for users |
| `test/` | Offline tests and labelled/captured fixtures |
| `scripts/` | Opt-in live Jev evaluations |
| `docs/` | User/reference/development documentation |

## Offline checks

```sh
npm run typecheck
npm test
npm run check   # both
```

Tests use Node's built-in runner and type stripping. CI runs `npm run check` on Node 22.19, 24 and 26. No Jev key or paid network call is needed for these checks.

Captured classifier responses in `test/fixtures/jev-calibration.json` test response interpretation, normalization and fallback policy. They do **not** show how a live Jev model interprets today's classification instructions.

Extension tests use mocked Pi events/UI. Passing them does not establish that editor insertion, settlement timing, navigation or child detection works in every live host setup. Exercise the interactive flow too when modifying those boundaries.

## Live routing evaluation

These commands require a source checkout, dependencies and Jev credentials in the process environment. They make real network calls and may incur charges. They are **not** part of `npm test` or the standard CI check.

```sh
npm run eval:jev
npm run eval:jev -- --only after
npm run eval:jev -- --json /tmp/jewter-routes.json
```

Fixture: `test/fixtures/jev-live-eval.json`.

- `before`: older complexity instructions, no `verification` role, previous implementation description.
- `after`: current question builder and configured roles.
- `roles`: accepted role names for each prompt.
- `tiers`: accepted tiers, optional when the prompt alone cannot decide.

By default, each prompt is sent once per variant, with a concurrency of four. Role scores compare the returned role name against the label, even if low confidence prevented applying it. Tier scores include **only switched cases with tier labels**. Compare abstentions, errors and denominator changes as well as accuracy; a higher fraction on fewer applied cases is not necessarily an improvement.

The script uses the Jewter config for its working directory and current environment, so custom roles, thresholds and project settings can change results. Unlike the extension's normal project-trust gate, the script calls `loadConfig` without an explicit untrusted-project flag; only run it from a checkout/project whose config you trust. It classifies the standalone fixture prompts, not real previous exchanges.

## Live verification evaluation

```sh
npm run eval:verify
```

Fixture: `test/fixtures/jev-verify-eval.json`. Each case describes a run: request, changed paths, commands, optional recognized tests/indirect mutations, final reply and acceptable outcomes.

The script calls Jev once per case (concurrently) and applies your configured `verify.minConfidence`. Strict labels contribute to accuracy, false-hint and missed-hint counts. Cases accepting either result are shown but excluded from strict accuracy. Request errors are reported separately and excluded from that denominator too.

Fixtures are authored summaries, not automatically recorded repository truth. Optional `tests` fields are supplied by the fixture; this evaluation does not exercise tool-command recognition. Mutation/test recognition and Pi event wiring need their own offline/interactive tests.

## Evaluate changes honestly

- Keep examples that failed, not just easy successes.
- Include mechanical edits, subtle bugs, irrelevant green tests, failed checks, and missing/misleading evidence.
- Repeat runs: Jev answers and confidence vary.
- Separate tuning examples from held-out evaluation cases.
- Inspect low-confidence abstentions, errors and sample sizes.
- Measure end-to-end correction rate, time and total cost when comparing physical model profiles. A classifier score is not a test of the answering model.
- Treat confidence as a model signal, not a calibrated correctness probability.

Small fixtures are regression aids, not evidence of security, production reliability or a universal best model.

## Interactive smoke checks

After a relevant change, use a scratch project/session to check:

1. Load only one copy of Jewter; configure authenticated physical models and Jev.
2. Select `jewter/auto`, ask a small task, inspect footer/card and physical **Models** receipt.
3. Ask a follow-up referring to earlier work; verify the bounded previous exchange is sufficient or the fallback is safe.
4. Make an untested risky edit; check the hint appears only on a confident Jev `suggest`.
5. Repeat while a draft is in the editor; automatic insertion must not overwrite it. `/jewter verify` deliberately replaces it but does not send.
6. Run relevant tests, then inspect the observed evidence and Jev's decision without treating silence as proof.
7. Exercise shell/custom-tool changes, unknown targets, failures and cancellation.
8. Navigate/start a new request while a check is pending; stale hints must not appear.
9. Test the exact subagent foreground/background mode, including provider extension loading and separate child receipts.
10. If compaction changed, test manual/automatic boundaries, unsupported/custom instructions, fallback, cancellation and summary bounds.

Use a scratch project because these steps involve real edits and potentially paid calls.

## Documentation and package checks

```sh
npm pack --dry-run
```

User-facing `docs/` and `examples/` are included in the npm package. Development scripts and fixtures are repository-only; the live evaluation commands require a checkout rather than just an installed package.

When defaults, commands or policy change, update:

- [README](../README.md) for entry points.
- [Configuration](configuration.md) for defaults, ranges and inheritance.
- [Behavior](behavior.md) for evidence, bounds, privacy and failure semantics.
- [Workflows](workflows.md) and profiles if model/effort policy changes.
- [Troubleshooting](troubleshooting.md) for operational implications.
- [Changelog](../CHANGELOG.md), under `Unreleased` until a release is prepared.

Documentation should distinguish intended policy, observed facts, heuristics and guarantees. Do not claim arbitrary shell changes are fully tracked, green commands prove coverage, or a small live fixture proves reliability.

## Release boundaries

`package.json` version and published npm version are separate from Git `main`. `pi update git:github.com/bobuk/pi-jewter` fetches Git commits; it does not publish a release. `pi update npm:pi-jewter` retrieves an npm version, not unreleased commits.

Before a release, review `Unreleased`, verify the package contents and offline checks, bump the version/lockfile deliberately, and test the normal external install/update flow. Publishing, tagging and pushing are separate actions, not effects of editing documentation or running tests.
