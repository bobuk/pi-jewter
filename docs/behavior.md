# Behavior, evidence and limitations

[README](../README.md) · [Configuration](configuration.md) · [Workflows](workflows.md)

## `/psst` side questions

`/psst <question>` uses the same Jev classifier and configured physical tiers as the main router, but keeps a separate, bounded in-memory Q&A history. It does not add side prompts or answers to the main transcript, does not inherit the main conversation, and has no tools. It cannot inspect files or make workspace changes. `/psst inject` places the side Q&A into the editor; the user decides whether to submit it. `/psst clear` empties the history. History is lost on session change or Pi restart.

## Routing

By default (`routing.mode: "step"`), the virtual router classifies **each agent-loop step**, including continuations after tools. Select `request` to classify only new user requests.

1. Send Jev the current prompt, current role when known, and a bounded previous exchange to resolve follow-ups. On continuations in step mode, include bounded recent assistant actions and tool results; ask for the role and capability needed for the **next response**, not the entire original task.
2. Ask for a role choice and a complexity score. Complexity describes required knowledge, judgement, ambiguity and risk, not file count.
3. Reject missing, unknown, `none`, or low-confidence roles. Keep the previous physical model when possible.
4. Normalize complexity using Jev's advertised numeric legend when available. Confident scores map to `fast`/`medium`/`strong` using the configured thresholds.
5. If complexity is uncertain, use a level with probability at least `tierMajority`; otherwise use `medium` for the accepted role. Footer notes distinguish majority selection from default fallback.
6. Resolve model and thinking independently from role overrides and global tiers. A matching role/tier still re-resolves physical settings, so config changes can take effect.
7. Before a mid-request physical switch, apply `routing.cachePenalty`: require both role and complexity confidence ≥ `min(1, jev.minConfidence + cachePenalty)` and a confident complexity score. Otherwise keep the previous model/state with a `cache-penalty` receipt. Zero disables this heuristic. Same-model thinking changes and new user requests are not penalized.
8. If the selected physical model is unavailable, retain the previous model. On an initial request without a previous model, try configured tiers in order `medium`, `fast`, `strong` for the fallback role. If none is available, fail with a configuration error.

Jev errors normally keep the prior model. Cancellation is propagated. Retries keep the failed model (or previous/fallback when absent), and direct calls bypass classification. Continuations are reclassified only in step mode. The router does not automatically promote a failed task to a stronger model.

`jewter/<role>` supplies a fallback role; it does not constrain Jev to that role. Select a physical model directly for a fixed choice. Changing providers/models can lose prompt-cache benefits; no cache-preservation or cost-optimality guarantee is made.

### What Jev sees for routing

- Current user text: at most 16,000 characters.
- Current role, when known.
- Previous user text: at most 500 characters.
- Previous assistant text: at most 1,500 characters (head and tail if longer).
- Configured role descriptions and the classification questions.
- In step-mode continuations only: the last eight messages since the latest user prompt, capped at 8,000 characters total (head and tail). Assistant text is capped at 1,500 characters per block, tool-call arguments at 1,000, and tool-result text at 2,000 per message. Thinking blocks, images and system messages are excluded. Excerpts are treated as untrusted evidence, not instructions.

Request mode does not send tool output; neither mode sends full history. A complex follow-up can lose crucial context at these bounds; ask a more explicit question or choose a model manually. `/jewter route` previews the supplied text without the conversation excerpt or an applied model switch.

## Verification hints

Hints are enabled by default. At the final `agent_settled` boundary, a candidate must be:

- A run started by a user message with nonempty text.
- In an interactive UI and not a detected child session.
- Not aborted, not already routed as `verification`.
- Associated with at least one observed successful edit or recognized indirect mutation.
- With both routing toggles and `verify.enabled` enabled.

The extension can observe physical-model runs too: hint eligibility is not restricted to `jewter/auto`. Selecting another model is not a substitute for disabling hints.

It asks Jev once in the background. Only `choice: suggest` with finite confidence between `verify.minConfidence` and 1 produces a hint. `skip`, low confidence, missing/malformed choices and request errors produce no suggestion. A newer request or session navigation invalidates a pending suggestion. A hint failure is silently ignored; it is not a successful check.

### Evidence sent to Jev

| Field | Bound / meaning |
| --- | --- |
| `request` | At most 4,000 characters plus omission marker |
| `changed_files` | Up to 40 distinct direct paths and indirect mutation labels |
| `indirect_changes` | Up to 20 indirect paths/labels, including unknown-target markers |
| `edit_calls`, `indirect_edit_calls` | Observed successful call counts |
| `commands` | Last 12 observed shell commands, at most 200 characters each, labelled by tool outcome |
| `tests` | Last 12 commands recognized by name as test-like, same text bound, labelled by tool outcome |
| `tool_errors` | Observed count |
| `final_message` | At most 1,500 characters plus omission marker; assistant-authored, not independently verified |

The question asks Jev to assess whether relevant behavioral checks passed. It warns that build, lint and typecheck alone are not behavioral tests, and that a test command's name does not establish coverage.

### What detection does not prove

- Mutation detection uses known editor names and heuristics on shell commands/custom tool names. It is **not a filesystem watcher or Git diff**. It misses arbitrary scripts, remote changes, changes outside observed tools, and work done inside children without forwarded tool events. It can count commands that did not actually change files.
- Shell/custom operations can have unknown targets. Jewter reports a label rather than inventing paths. Failed tools can partially change files without being counted as successful edits.
- Test detection is a command-name heuristic. For example, `npm run check` can mean something different in each project. It does not inspect package scripts, assertions, test coverage, logs or structured test results.
- Command success is derived from the tool's `isError`, not independently measured process exit codes. Pipelines, `|| true`, custom wrappers and a command that merely mentions a test can mislead it.
- Commands are collected throughout the run. The evidence has **no per-edit chronology**: a passed test could have run before the last edit. Do not interpret the hint decision as proof that the final state was tested.
- Jev gets no patch or diff and no tool-result body. It cannot confirm which behavior changed or whether a regression test fails on the old version.
- The final reply can contain mistaken claims. It is one input to a probabilistic suggestion, not an authority.

These limits are why the feature is a **hint**, not a merge/deploy gate. Silence means neither “safe” nor “verified”.

### What the user sees

A suggestion is a persisted UI-only `jewter-verify` entry with confidence and a prepared verification request. If the editor is empty, Jewter fills it without sending. Existing drafts are left untouched by the automatic hint. The generated request uses Russian when the original prompt contains Cyrillic characters, English otherwise; it is not general language detection.

`/jewter verify` explicitly **replaces** the editor text with the last suggestion on the current branch. It does not check whether that suggestion is stale or consumed, so review the request before submitting it. Sending it normally classifies as `verification`, but classification is not guaranteed or forced.

## Model receipts

A **Models** receipt appears at final settlement, including retries and automatic continuations, when `ui.report` is enabled. It is a persisted `jewter-model-report` UI entry, not text sent to an LLM. It adds no model call and does not trigger another turn.

It reports physical provider/model IDs from assistant messages, observed thinking levels, applied routes, executed tools and response counts. Failed/aborted attempts remain visible. It does not substitute the classifier's proposed model for the model that actually answered, and it does not claim tool execution proves correct edits or tests.

Jev is not an answering model and is omitted from the receipt's model list. Jewter's physical compaction fallback LLM calls are reported separately. Child sessions have their own receipts; parent delegation calls do not attribute the child's model or work to the parent. Native Pi compaction and internal calls in other extensions are not assigned guessed models.

Routing cards and receipts are independently toggleable. The footer shows only the latest routing state; branch records retain previous decisions. In JSON mode inspect `entry_appended` events; plain print mode leaves assistant text unmodified.

## Selective compaction

**Off by default.** The independent `compaction.enabled` switch controls whether Jewter handles Pi's `/compact` or automatic compaction boundary. Disabling routing does not disable it.

1. Collect eligible large, non-error tool results from the replaced span. Keep the last tool result at the cut boundary intact.
2. Ask Jev `keep` or `shorten`, with bounded result excerpts, recent retained context and user requests. Incomplete head/tail excerpts are marked as such.
3. Send uncertain/missing decisions and confident `shorten` decisions based on incomplete excerpts to one bounded physical LLM request with wider views. If it cannot decide or fails, retain those results.
4. For accepted `shorten`, keep beginning and end with an omission marker. Preserve user/assistant text, tool calls, prior summaries and error results.
5. Check reduction and full resulting summary size. If below `minReduction` or above `maxSummaryChars`, let Pi's own compactor run instead.

Custom `/compact` instructions, unsupported message/image content, Jev failure, aborts or insufficient reduction also fall back to Pi. Newest retained context remains Pi's responsibility. Successful entries identify `details.engine: "jewter"` and include statistics. Status and notifications describe the outcome.

The fallback model follows the global `fast` model unless explicitly set. Compaction thinking is separate from tier thinking; `auto` means `low` here. The LLM sees at most a 60,000-character total result-excerpt budget, with wider per-result excerpts than Jev; it still cannot prove hidden content is irrelevant.

Shortening is probabilistic and potentially lossy. Test on representative sessions before relying on it. Size/reduction are character-based, not an exact token or cost calculation.

### Migrating from pi-jev or another compactor

Jewter does not uninstall or alter `@alexlikevibe/pi-jev` or other extensions. Disable competing routing selectors while using Jewter routing, and disable other compaction handlers **before** enabling Jewter compaction. Remove the old package only after testing if you no longer need it.

## Privacy and costs

All model calls use the configured transport/providers. The relevant data leaves your machine:

| Call | Data | Frequency |
| --- | --- | --- |
| Routing Jev | Bounded prompt/previous exchange, role descriptions | Each routed user request; `/jewter route` also calls Jev |
| Verification Jev | Bounded request, paths, commands/test-like labels, final reply | One per eligible settled run |
| Compaction Jev | Conversation and tool-result excerpts | When enabled and candidates are evaluated |
| Compaction fallback LLM | Wider excerpts and context | When candidates need a second opinion |
| Answering physical model | Normal Pi request context | Normal assistant/tool loop |

Paths, command arguments, prompt text and tool output can contain secrets or sensitive project information. Bounded excerpts are **not redaction**. Review endpoints and provider policies before enabling features on confidential work. Credentials stay in the environment; no key field is required in `jewter.json`.

Jev latency/cost is separate from physical model use and is not currently included in Pi's session cost totals. Compaction fallback LLM usage is attached when Pi accepts custom compaction. If the custom result is rejected and Pi compaction takes over, those spent fallback calls are not added to session totals; the skip notification can report them. The receipt is not a complete billing ledger, especially for calls in other extensions.

Confidence is a model-supplied signal, not a calibrated probability that the result is correct. Small live evaluation fixtures validate examples, not production reliability or security.

### Service context budgets

Jewter fits the full serialized Jev request, including the model and all questions,
within a 24,000 UTF-8 byte operational budget. This is a conservative local
estimate, not a tokenizer measurement or a guarantee about a provider's context
limit. JSON escaping and Unicode bytes count toward the budget. Only classifier
views of conversation evidence can shrink. Criteria, question instructions,
schemas, model names and result IDs remain intact. Fixed overhead that cannot
fit causes a safe refusal before a network call.

The compaction fallback fits its complete message envelope within the model's
advertised context, with a base answer budget of up to 2,048 tokens and 1,024
additional tokens reserved for provider framing. Before fitting input, it reserves
the model's full output maximum for budget-based Anthropic and Bedrock Claude
reasoning calls. This conservative local reserve covers additive thinking without
importing private SDK helpers or copying their level-specific formulas. For
example, any enabled thinking level with a 2,048 base budget and a 16,384 model
output maximum reserves 16,384 tokens. Adaptive Anthropic calls retain the base
ceiling. All Bedrock reasoning calls use the full output maximum,
including adaptive models. Other APIs retain the base ceiling.
Configured thinking is preserved. If its output reserve and fixed input overhead
cannot fit, Jewter refuses the fallback and lets Pi compact; it does not silently
lower thinking. SDK context clamps can reduce actual output further.
It estimates input tokens using serialized UTF-8 bytes. Missing model metadata
uses an 8,192 context estimate and a 2,048 model output maximum. These are
estimates; a provider can still reject the request. There are no context retries.
A Jev context failure stops further Jev batches and sends unresolved results to
one fitted fallback request. Unresolved results stay intact. If selective
compaction cannot safely reduce the context, Pi's normal compaction runs.
The original conversation and tool evidence are never changed by request fitting.

Local `jewter-service-context` session entries record only a version, service,
purpose and fixed event category for view reduction or context failure. These
entries stay outside model context. They contain no prompts, credentials or raw
provider error text. Context failures remain recorded even when fallback succeeds.

Jev response reading is protected through body decoding and bounded by `jev.maxResponseBytes` (default 256,000 bytes). Context errors become fixed local categories. Cancellation and timeout take priority over provider error classification and never create a provider-overflow entry.
