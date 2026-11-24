# Contributing to pi-jewter

Thanks for your interest in contributing to `pi-jewter`.

## Getting started

Requirements: **Node 22.19.0+** (no build step; tests run with Node's built-in test runner and type stripping).

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs `npm run typecheck` and `npm test` completely offline — no Jev API key or network calls are required.

For full local development instructions, repository layout, interactive smoke checks and evaluation workflows, see [docs/development.md](docs/development.md).

## Making changes

- Keep pull requests focused on one clear change.
- Add or update offline unit/integration tests under `test/` for behavior changes and bug fixes.
- Keep documentation in sync when defaults, commands, configuration or privacy/behavior boundaries change (`README.md`, `docs/`).
- Add a concise entry under `## [Unreleased]` in `CHANGELOG.md` for user-visible changes.
- Follow the existing commit style (`feat(...)`, `fix(...)`, `docs(...)`, `test(...)`, `chore(...)`).

## Live evaluations

`npm run eval:jev` and `npm run eval:verify` make **real, potentially paid** network calls using your Jev credentials. They are opt-in and are not run in CI. Never commit API keys or private transcripts.

## Secrets and local config

Do not commit `.pi/jewter.json` or any saved `typesafeApiKey`. Prefer environment variables (`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`) or global scope (`~/.pi/agent/jewter.json`) during development.

## Security issues

Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
