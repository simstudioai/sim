/**
 * The "How it runs" section of `INDEX.md`: run-time behaviour the types cannot show and an author
 * would otherwise guess. Each item restates what the code does today, so a change there must
 * update it:
 *
 * - retries: `apps/sim/tools/index.ts` (`getRetryConfig` and the request loop),
 *   `apps/sim/executor/execution/block-executor.ts` (`runHandlerWithRetry`),
 *   `apps/sim/lib/workflows/blocks/retry-eligibility.ts`;
 * - `onError`: `block-executor.ts` (`handleBlockError`), `executor/execution/edge-manager.ts`
 *   (`shouldActivateEdge`), `executor/orchestrators/loop.ts` (`storeLoopNodeOutput`);
 * - joins: `edge-manager.ts` (`processOutgoingEdges`, `isNodeReady`); a block that did not run:
 *   `executor/utils/block-reference.ts` (`resolveBlockReference`), `executor/variables/resolver.ts`
 *   (`RESOLVED_EMPTY`);
 * - loop and parallel results: `executor/orchestrators/node.ts` (`handleLoopNodeCompletion`,
 *   `handleParallelNodeCompletion`), `orchestrators/loop.ts` and `parallel.ts` (`results`);
 * - outputs in function code: `executor/variables/resolver.ts` (`resolveCodeWithContextVars`,
 *   `formatContextVariableReference`);
 * - child workflows: `executor/handlers/workflow/handler.ts` (`mapChildOutputToParent`,
 *   `useDeployed`), `executor/execution/engine.ts` (`setFinalOutput`);
 * - MCP headers: `packages/workspace-code/src/kinds/mcp.ts` (`readHeaderValue`),
 *   `apps/sim/lib/mcp/resolve-config.ts`;
 * - MCP tool names: `codegen/workspace.ts` (`mcpServers`), the MCP workspace-source adapter's
 *   `checkRefs`, `executor/handlers/agent/handler.ts` (`processMcpToolsBatched`);
 * - table row keys: `apps/sim/lib/table/application/rows.ts` (`rowWriteOptions`, the upsert's
 *   `conflictTarget`), `packages/workspace-code/src/kinds/table.ts` (`columnName`).
 */
export const RUNTIME_SEMANTICS: readonly string[] = [
  '## How it runs',
  '',
  "- **Two retries, nested.** An `api` block's `retries`, `retryDelayMs` and `retryMaxDelayMs` repeat the HTTP request inside one run of the block: only after a timeout, a connection reset, a 429 or a 5xx (a host that does not resolve or refuses the connection fails at once), only for GET, HEAD, PUT and DELETE unless `retryNonIdempotent: true`, with jittered exponential backoff capped at `retryMaxDelayMs` (a `Retry-After` beyond the cap ends the retries). `meta.retry` (`{ enabled, maxTries, waitBetweenTriesMs }`) reruns the whole block, request retries included, after any failure but a stop or a failed child workflow; `maxTries` counts every try. So `retries: 2` under `maxTries: 3` sends up to 9 requests. Only the last try's failure reaches `onError`. Triggers and `human` never retry.",
  "- **`onError`.** `x.onError(y)` makes a failure of `x` an output, `{ error: '<message>' }`, and runs `y` instead of `x`'s other targets; the run goes on. `y` reads the message as `x.error` (only a block with an `onError` edge has it). In a loop or parallel body (`y` must be in the same body) the iteration ends normally and the loop moves to the next item, with that error output as `x`'s entry for the iteration. Without `onError`, a failure in any iteration fails the run and stops the loop.",
  "- **Joins run once.** A block with several incoming edges runs once, after every one of them has fired or been ruled out (a condition or router branch not taken, the normal edge of a block that failed into `onError`). `a.to(join)`, `b.to(join)`, `c.to(join)` wait for all three; behind a condition only the taken branch fires, and the join runs once after it. A block never runs once per incoming branch. A reference to a block that did not run (on the branch not taken) resolves empty: `null` as a whole value, in function code or in a condition, `''` inside text.",
  '- **Loop and parallel results.** `x.results` holds one entry per iteration (a parallel: per branch), and each entry is the list of outputs of the body blocks that ran in it, in the order they finished. With one block in the body its output is `x.results[i][0]`; `x.results.flat()` lists every output.',
  "- **Outputs in function code.** In `fn` code, `\u0024{a.content}` inside js`` is not spliced in as text: it becomes an expression that evaluates to the output's value, a string as a string and an object as an object. Write it where an expression goes (`const reply = \u0024{a.content}`, `[\u0024{a.content}, \u0024{b.content}]`) and never wrap it in quotes. Written inside a JavaScript string or template literal it splices in as JSON, quotes included (`'Hi \u0024{a.content}'` gives `Hi \"hello\"`). Python code works the same way.",
  "- **Child workflows.** `const c = runWorkflow('C', { workflowId: childWorkflow('k'), inputMapping })` outputs the child's run as `c.result`: the output of the first `response` block the child reaches, `{ data, status, headers }` (a field of its `body` is `c.result.data.field`), or, with no `response` block, the output of the last block it ran. `c.result` is untyped: wrap a value that should become text in `t`. A deployed run of the parent (API, webhook, schedule, chat) runs the child's deployed version and fails while the child is not deployed; a run from the editor runs the child's draft. A failed child fails `c` (`c.onError(...)` catches it).",
  "- **MCP headers** (`mcp/<key>.ts`). A header value is plain text in which `{{NAME}}` names an env variable anywhere (`Authorization: 'Bearer {{GITHUB_TOKEN}}'`), `env.NAME` for a whole value, or `stored()` to keep the value the server holds. A `t` template or a template literal with `\u0024{}` is refused. A credential header (`Authorization`, `Cookie`, or a name with `key`, `token`, `secret`, `auth`, `password`, `session`, `signature` or `credential`) holds nothing but an optional scheme word (`Bearer`, `Basic`, `Token`, `Bot`, `ApiKey`) and `{{NAME}}` references (`E_MCP_LITERAL_SECRET`). The variables resolve when the server connects, from the personal and workspace env (the workspace value wins); a missing one fails the connection.",
  "- **Table rows are keyed by column name.** A Table block's `data` (and `conflictColumn`, and a filter's `field`) names each column by its name: its key in `tables/<key>.ts`, or the `name` set there (`phone: column.string({ name: 'mobile' })` is written `{ mobile: … }`). A key naming no column is dropped from the row at run time; `check` and `apply` warn on it (`W_TABLE_UNKNOWN_COLUMN`). A table's `rows.jsonl` is the exception: it is keyed by column key.",
  "- **MCP tool names are checked late.** `mcp('k').tool('name')` is type-checked only when `workspace.d.ts` lists that server's tools; a server that could not be listed, or one declared but not yet applied, takes any name. `sim workflows source check` and `sim workflows source apply` do not check tool names (the apply checks only that the server exists). `sim workspaces source apply` checks the tools of each workflow it changes against the server's live listing (`E_MCP_TOOL_UNKNOWN`, or `W_MCP_TOOLS_UNCHECKED` when it cannot list the server). Otherwise a wrong name surfaces at run time: the agent block fails before the model runs, `MCP operation \"name\" is missing or not permitted`.",
  '',
]
