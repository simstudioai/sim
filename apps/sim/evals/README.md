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

## Report shape

`report.json` is machine-readable for dashboards and trend tracking; `report.md`
is the same data as a table. Each result carries the scenario id, pass/fail,
every named check with a failure detail, the final content, the executed tool
invocations, and metrics: iterations, tool call counts (success/error), latency,
model/tool time, first-response time, and token usage.

## Scope and next steps

This suite evaluates the tool loop directly. The next layer is a scenario that
runs the same scripted model through the full `DAGExecutor` so agent block
wiring, variable resolution, and the executor's retry/fallback policy are
measured alongside the loop. The `AgentToolUseResult` shape is deliberately
independent of the harness entry point so both can share scoring and reporting.
