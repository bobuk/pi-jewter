# Workflows and profiles

[README](../README.md) · [Configuration](configuration.md) · [Behavior](behavior.md)

## Capability and thoroughness are different

The core policy is:

> Choose the model for the capability the task needs; choose thinking for the thoroughness and autonomy you want.

| Work | Capability tier | Thinking starting point |
| --- | --- | --- |
| Lookup, precise mechanical edit | `fast` | `low` |
| Ordinary feature with a clear approach | `medium` | Explicit supported baseline, often `medium` |
| Requirements interview or quick architecture sketch | Depends on needed judgement | `low` for fast feedback |
| Subtle debugging, unfamiliar domain, difficult architecture | `strong` | Baseline or `high`, depending on verification needs |
| Tests, reproductions, adversarial review | Depends on problem difficulty | `high` where supported |
| Difficult unsupervised end-to-end task | Capable model | Higher effort, possibly `max`, deliberately chosen |

A rename across 200 files can be mechanically simple. A short “migrate production without downtime” request can require substantial judgement. Tier names do not measure speed, price or quality automatically: their actual meaning depends on the models you assign.

A strong model with low thinking can be a useful expert for a short conversation. A cheaper model with high thinking can be a thorough worker on a bounded task. Increasing thinking cannot reliably fix a wrong approach or missing capability.

Pi's thinking controls are provider-specific. These are starting points to evaluate, not universal laws. `auto` means inherited session thinking, **not provider default effort**.

## Spec → implementation → verification

A useful supervised loop:

1. **Clarify the goal.** “Interview me about missing requirements before implementing.”
2. **Agree on acceptance criteria and scope.** “What observable result would prove this works? What is out of scope?”
3. **Implement a small slice.** Use a capable-enough model and lower effort when you want fast iteration.
4. **Check real outcomes.** Reproduce the bug, run a relevant regression test, exercise the UI or deployed service, verify receipts/data against the underlying source.
5. **Iterate from evidence.** Feed failures back into the next slice; keep valuable failure cases for future evaluation.

Jewter helps select models for these requests. It does not enforce a lifecycle, write a spec or acceptance tests automatically, integrate with Plannotator, or block implementation pending approval. Prompts for requirement interviews and acceptance criteria are intended to classify as `planning`; tests/validation as `verification`. All classification remains probabilistic.

A verification hint is an invitation to step 4, not evidence that step 4 happened. The user must submit the suggested request. See [hint behavior](behavior.md#verification-hints).

## Independent criticism

When useful, give `review` or `verification` a model from a different family than `implementation`. This can expose different blind spots. It does not prove independence or correctness: two models can agree on the same mistake.

Prefer directly checkable evidence over a second model's reassurance. A passing command, a prose “tests pass”, and an actual regression test covering the changed behavior are different levels of evidence.

Jewter does not detect model families or dynamically select an independent critic based on the preceding author. The role assignments are static. For example, a `strong` implementation and a `strong` verification may use the same expert in the supplied profiles. Override those slots if cross-family checking matters for your work.

## Example profiles

These files are illustrative configurations, not benchmark-backed rankings or guaranteed cost savings:

- [Price profile](../examples/jewter.price.json): expert slots use `openrouter/deepseek/deepseek-v4.1-flash`.
- [Quality profile](../examples/jewter.quality.json): expert slots use `claude-bridge/claude-opus-5-5`.

The labels reflect the intended trade-off, not a claim that Opus always performs better or DeepSeek is less capable. Validate both on your own tasks and include subscription limits, retry rates and total task time when assessing cost.

| Slot | Price | Quality |
| --- | --- | --- |
| Global `fast` | `openai-codex/gpt-6-luna`, low | Same |
| Global `medium` | `openai-codex/gpt-6.1-sol`, medium | Same |
| Global `strong` | DeepSeek, medium | Opus, medium |
| `planning/fast` | Luna, low | Opus, low |
| `planning/medium` | DeepSeek, medium | Opus, medium |
| `planning/strong` | DeepSeek, high | Opus, high |
| `verification/fast` | Luna, medium | Same |
| `verification/medium` | Sol, high | Same |
| `verification/strong` | DeepSeek, high | Opus, high |
| `review/fast` | `openai-codex/gpt-6.1-terra`, medium | Same |
| `review/medium`, `review/strong` | DeepSeek, high | Opus, high |

Other role tiers inherit global assignments. Both profiles select OpenRouter for Jev and **enable compaction with Luna**. Neither explicitly sets `verify`, so built-in hint defaults apply (`enabled: true`, confidence `0.8`). They do not install subagent bindings.

### Apply a profile safely

1. Check the IDs in `pi --list-models` and authenticate the providers you intend to use. `claude-bridge` requires its own extension/setup; it is not supplied by Jewter.
2. Back up your existing global `jewter.json` outside the project if it exists.
3. Ask **Configure in a chat with Pi** to merge the chosen profile into your configuration, or merge it manually. Preserve unrelated fields and custom roles.
4. Decide explicitly whether to keep the example's `compaction.enabled: true`.
5. `/reload`, inspect `/jewter`, and preview representative requests with `/jewter route`.

If you intentionally want a full replacement, copy the chosen example from your repository checkout to the global config path. Copying replaces the file; it is not a merge. For a custom `PI_CODING_AGENT_DIR`, use that directory instead of `~/.pi/agent`.

Use the same process to switch profiles. Existing project/environment overrides continue to take precedence.

## Subagents

A capable coordinator with bounded, cheaper workers is a workflow choice. Jewter does not create or invoke subagents, force the main session onto a strong model, or guarantee children use cheaper models. Their prompts are classified against the same configured tiers.

Suggested bindings, when these agents exist:

| Agent | Fallback role |
| --- | --- |
| `worker` | `implementation` |
| `scout` | `quick` |
| `researcher` | `research` |
| `reviewer` | `review` |
| `oracle` | `planning` |
| `evidence-auditor` | `verification` (or a dedicated evidence-review role) |

These are starting points, not required names or agent installations. `verification` defaults are code/test-oriented; for source audits, define a role whose description and model choices match that work.

Configure bindings in `/jewter` → **Subagents**. `auto` permits free role selection; a named role is a fallback, **not a lock**. Other per-run model overrides take precedence. Selecting `off` on a bound agent removes its Jewter routing override while preserving other agent settings.

Child sessions must load Jewter and any provider extensions they need. `pi-subagents` foreground/background modes have different extension-loading policies. Test the exact mode you plan to use. Verification hints are suppressed in detected child sessions; their own receipts remain separate from the parent's.

## When the answer is wrong

Before changing a dial, check the prompt, project instructions, available tools, skill selection and scope.

- **Missing context or wrong assumptions:** clarify the spec/context. More effort can elaborate the wrong interpretation.
- **Skipped files, tests or edge cases:** increase thinking, or explicitly request a verification pass.
- **Clearly tried but misunderstood the domain:** try a more capable model rather than just higher thinking.
- **Routine work for a while:** a cheaper model or lower effort may be enough.

Jewter does not automatically diagnose failures or escalate on these rules. Manual physical model selection is always available through `/model`.

## Sources and boundaries

The capability/thoroughness distinction and verification-heavy use of higher effort draw on Anthropic's [Spending your effort](https://claude.dev/blog/spending-your-effort/) and [Choosing a Claude model and effort level](https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code).

Spec-first, human-supervised work and explicit verification are also discussed in Karpathy's [AI Ascent 2026 write-up](https://karpathy.bearblog.dev/sequoia-ascent-2026/) and [Verifiability](https://karpathy.bearblog.dev/verifiability/). The popular “spec, verifier, environment” three-layer presentation is an interpretation of such ideas, not a Jewter algorithm or a guarantee of performance. Jewter stays a routing aid; project instructions, approval rules, skills and enforced tool permissions belong to the surrounding workflow.
