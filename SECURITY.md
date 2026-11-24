# Security Policy

## Supported Versions

Security fixes are applied to the latest minor release on `main`.

| Version | Supported |
| --- | --- |
| `0.3.x` | Yes |
| `< 0.3.0` | No |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Use GitHub's private vulnerability reporting instead:
<https://github.com/bobuk/pi-jewter/security/advisories/new>

Include as much of the following as you can:

- A description of the issue and its impact
- Reproduction steps or a minimal proof of concept
- Pi version, Node version, and `pi-jewter` version or commit
- Any suggested fix or mitigation

Please redact API keys, private prompt text, file paths and tool output before sharing reports.

## Security & Privacy Scope

Relevant areas for `pi-jewter` include:

- **Credential handling**: `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `JEWTER_API_KEY`, and optional plain-text `jev.typesafeApiKey` storage in `jewter.json`.
- **Project trust gating**: untrusted `.pi/jewter.json` files must not silently override endpoints, models or routing settings.
- **External data exposure**: Jewter sends bounded prompt, context and tool excerpts to Jev (TypeSafe or OpenRouter). Excerpts are **not redaction**; see [docs/behavior.md](docs/behavior.md) for what is sent and when.
