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

## Releasing

Every release is a Git tag `vX.Y.Z` that matches `package.json`, plus the same version on npm. Both come from one command, run by a maintainer who is logged in to npm:

```sh
./release.sh X.Y.Z --dry-run   # all checks and `npm publish --dry-run`; changes nothing
./release.sh X.Y.Z             # commit, tag, publish to npm, push
```

`pi update git:github.com/bobuk/pi-jewter` fetches Git commits; it does not publish a release. `pi update npm:pi-jewter` retrieves the npm `latest` version, not unreleased commits.

### Before running it

1. Describe the release under `## [Unreleased]` in `CHANGELOG.md`, commit and push. The script refuses an empty Unreleased section.
2. `npm login` once on the machine. Publishing may ask for a 2FA code or browser confirmation.

### What `release.sh` does

It checks everything first and changes nothing if a check fails:

- current branch is `main`, the working tree is clean, and `main` equals `origin/main`;
- the version looks like `1.2.3` or `1.2.3-rc.1` (a leading `v` is accepted) and is higher than `package.json`;
- `CHANGELOG.md` has non-empty Unreleased entries and no section for this version yet;
- the tag does not exist locally or on `origin`;
- npm does not have this version, and a stable version is higher than npm `latest`;
- you are logged in to npm (`npm whoami`);
- `npm ci --ignore-scripts`, `npm run check` and `npm pack --dry-run` pass.

Then it moves the Unreleased entries under `## [X.Y.Z]`, sets the version in `package.json` and `package-lock.json`, commits `chore(release): X.Y.Z`, creates the annotated tag `vX.Y.Z`, runs `npm publish`, and finally pushes `main` and the tag with `git push --atomic`.

Pre-releases such as `X.Y.Z-rc.1` are published under the npm dist-tag `next`, so `latest` does not change. Stable versions use `latest`.

### When something fails

- **A check fails:** nothing was changed. Fix the reported problem and run again.
- **`npm publish` fails** (2FA, network, permissions): the commit and tag exist only locally; nothing was pushed. The script prints both options: retry `npm publish --access public --tag <dist-tag> && git push --atomic origin main vX.Y.Z`, or undo with `git tag -d vX.Y.Z && git reset --hard HEAD~1`.
- **The push fails after publishing:** the version is on npm, but the commit and tag are local. Run `git push --atomic origin main vX.Y.Z`. Atomic push sends both or neither, so `origin` never gets a tag without its commit.

npm versions cannot be republished, and unpublishing is restricted. Use `--dry-run` first when in doubt.

### After a release

Check `npm view pi-jewter version` and an external install, `pi install npm:pi-jewter`, in a separate Pi environment. Optionally create a GitHub Release for the tag with the changelog section as notes:

```sh
awk '/^## \[X.Y.Z\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md > /tmp/release-notes.md
gh release create vX.Y.Z --title "pi-jewter X.Y.Z" --notes-file /tmp/release-notes.md
```

A GitHub Release is documentation only; it does not publish anything.

`release.sh` and `scripts/release.ts` stay in the repository and are not part of the npm package. `NPM=/path/to/npm` overrides the npm executable, which the release tests use to stub publishing.
