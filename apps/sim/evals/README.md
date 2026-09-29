# Agent harness evaluations

Measurement for the agent harness — the code that turns a model's tool calls
into executed tools, feeds the results back, and keeps the turn alive when a
tool fails. Unit and integration tests prove the harness handles the cases we
already know about; evals measure whether it still behaves across a suite of
scenarios when the harness changes.

## What runs

The first suite lives in [`agent-tool-use/`](./agent-tool-use) and drives the
real OpenAI-compatible streaming tool loop
(`apps/sim/providers/openai-compat/streaming-tool-loop.ts`) — the loop that
serves OpenAI, DeepSeek, Groq, Cerebras, and the other OpenAI-compatible
providers. The model is **scripted**: each scenario supplies the assistant turns
(tool calls or a final answer) and the result of each tool call. That keeps the
suite deterministic and runnable in CI with no provider key, while the thing
being measured — tool dispatch, result feedback, error recovery — is real
production code.

The suites cover four behaviors:

| Category | What it measures |
| --- | --- |
| `tool-selection` | The loop dispatches the tool the model asked for, including from a set of distractors. |
| `planning` | Multi-turn, dependent and parallel tool calls execute in the right order and all results reach the next turn. |
| `retrieval` | Values returned by a tool survive into the final answer instead of being dropped or invented. |
| `recovery` | Tool errors, unknown tool names, and malformed argument JSON are fed back to the model rather than thrown out of the loop. |

## Run it

From `apps/sim`:

```sh
bun run test:evals
```

The command writes a JSON report and a Markdown summary to
`test-results/evals/agent-tool-use.{json,md}` (gitignored) and fails the process
if any scenario fails. To point the report somewhere else, run Vitest directly:

```sh
EVAL_REPORT_PATH=/tmp/agent-tool-use.json bunx vitest run evals/agent-tool-use
```

The suite is also picked up by the normal `bun run test` run, so a regression
fails CI even without the dedicated command.

## Run against a real model (live)

The same scenarios can be replayed against a live model. This is opt-in and
never runs in CI. DeepSeek is wired first; any OpenAI-compatible provider works
through `createOpenAICompatLiveCompletion` in `live.ts`.

```sh
cd apps/sim
DEEPSEEK_API_KEY=... bun run test:evals:live
```

Useful knobs:

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVAL_TRIALS` | `3` | Runs per scenario. Models are nondeterministic, so results are pass rates. |
| `EVAL_MIN_PASS_RATE` | `0` | When > 0, fail a scenario below this pass rate (0–1). |
| `EVAL_MODEL` | `deepseek-chat` | Model id sent to the provider. |
| `EVAL_TIMEOUT_MS` | `180000` | Per-request timeout. |
| `EVAL_REPORT_PATH` | `test-results/evals/agent-tool-use-live.json` | Report location. |
| `EVAL_RECORD` | `0` | Set to `1` to also write the first trial's transcript to `fixtures/`. |

Live runs relax exact assertions: `toolCallSequence` becomes an ordered
subsequence, `successfulToolCalls` becomes a minimum, and scripted-only cases
(malformed JSON, unknown tool) are skipped. A scenario-level `liveExpect`
overrides the scripted expectation where a real model cannot reproduce it (for
example, an exact retry count). The report is at
`test-results/evals/agent-tool-use-live.{json,md}` with pass rates, average
iterations, latency, and the failed check names.

### Record and replay

A live run is nondeterministic and needs a key; a fixture is neither. Record one
trial, then replay it forever through the real loop with no network:

```sh
cd apps/sim
EVAL_RECORD=1 DEEPSEEK_API_KEY=... bun run test:evals:live   # writes fixtures/*.json
bun run test:evals                                           # replays them, no key
```

`fixtures/<scenario>.json` holds the raw streamed chunks per model call, so a
diff shows a behavior change exactly as the model produced it. Fixtures are
committed and reviewed like snapshots. `agent-tool-use.replay.test.ts` replays
each one through `createOpenAICompatStreamingToolLoopStream` and scores it with
the same checks; the suite skips until at least one fixture exists. Re-record a
fixture when the scenario, prompt, or model intentionally changes.

## Add a case

1. Open [`agent-tool-use/scenarios.ts`](./agent-tool-use/scenarios.ts) and add
   an entry to `AGENT_TOOL_USE_SCENARIOS`.
2. Declare the `tools` the model may call and the `script` it produces. A
   `tools` turn lists the calls the model emits; an `answer` turn ends the run.
   Attach each call's stub `result` (or leave it to default to a successful
   empty output).
3. Add the assertions you care about under `expect`: the ordered
   `toolCallSequence`, `requiredTools`/`forbiddenTools`, `finalContent`,
   `maxIterations`, and tool call counts. Every assertion becomes a named check
   in the report.
4. Run `bun run test:evals`.

A scenario is data, not code — there is no harness change needed for a new case.

### Simulating a failure

- **Tool error:** give the call `result: { success: false, error: '...' }`.
- **Unknown tool:** call a `name` that is not in `tools`; the loop returns a
  tool-not-found error to the model.
- **Malformed arguments:** set `argumentsJson` to an invalid or non-object JSON
  string. The loop must not execute the call and must return the parse error to
  the model.

## Executor-level scenarios

[`agent-tool-use/executor-harness.ts`](./agent-tool-use/executor-harness.ts)
runs a case through a real `DAGExecutor`: a Start block → Agent block workflow,
with only the provider boundary (`executeProviderRequest`) mocked. This covers
what the loop harness cannot — agent-block input wiring, variable resolution
from Start outputs, and the executor's run/error handling. Tool dispatch stays
covered by the loop suite.

Add a case to `EXECUTOR_SCENARIOS` in `executor-harness.ts`:

- `workflowInput` is exposed on the Start block; reference an output with
  `<start.field>` from the Agent prompt.
- `agent` is the Agent block config (`model`, `systemPrompt`, `userPrompt`).
- `providerResponse` is what the mocked provider returns (`content`,
  `toolCalls`, `tokens`).
- `expect` uses the loop's checks plus `resolvedInput` (a substring that must
  reach the provider messages), `succeeds` (expected `ExecutionResult.success`),
  and `providerCalls` (exact provider call count).
- Set `agent.retry` to exercise the executor's per-block retry policy, or
  `agent.fallbackModels` to exercise model fallback. Make the first
  `providerResponse` a `reject` and the next one succeeds; assert
  `providerCalls` and `lastRequestModel` to prove which path recovered.

Both suites write one report, so executor rows appear alongside loop rows.

## Report shape

`report.json` is machine-readable for dashboards and trend tracking; `report.md`
is the same data as a table. Each result carries the scenario id, pass/fail,
every named check with a failure detail, the final content, the executed tool
invocations, and metrics: iterations, tool call counts (success/error), latency,
model/tool time, first-response time, and token usage.

## Scope and next steps

Two harnesses share one result shape and report: the tool loop and the
`DAGExecutor`. The executor suite covers both recovery paths — block retry
(`executor-retries-failed-block`) and model fallback
(`executor-falls-back-to-secondary-model`). Further expansion (context/memory,
model routing, subagent orchestration) is tracked as follow-up work.
