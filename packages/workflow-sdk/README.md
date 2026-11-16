# @sim/workflow-sdk

Types for Sim workflows written as TypeScript. A workflow file imports from this package, but
**nothing in it runs**: the server compiles the file statically, and every runtime export throws
`SimSdkNotExecutable`. The full grammar is
[`packages/workflow-code/src/compile/SYNTAX.md`](../workflow-code/src/compile/SYNTAX.md).

## Edit loop

```bash
sim workflows source get <workflowId> --dir ./wf               # 1. write the source tree
# 2. edit ./wf/workflow.ts (and ./wf/functions/*)
sim workflows source apply <workflowId> --dir ./wf --dry-run   # 3. check; writes nothing
sim workflows source apply <workflowId> --dir ./wf --yes       # 4. save the draft
```

1. **Get** writes `workflow.ts`, function files, the lock, the base and the types.
2. **Edit** `workflow.ts`. Declare blocks with `const x = builder('Name', params)` and wire them
   with `x.to(y)`. `tsc -p ./wf` type-checks locally.
3. **Dry run** compiles and runs every server check. Fix each error it prints, then run it again
   until it exits 0.
4. **Apply** saves the draft. It rewrites `./wf` from what was stored (normalized values show up
   there) and refreshes `.sim/lock.json` and `.sim/base.json`. Apply never deploys.
5. **On a 409** (`SOURCE_STALE`, exit 5) the workflow changed since you read it and nothing was
   saved. Run `get` into a fresh directory, reapply your edit there (diff your copy against the old
   source to find it), dry-run, apply. Keep the fresh `.sim/` files: `.sim/base.json` holds the
   fingerprint that makes the next apply safe.
6. **New workflow**: write `workflow.ts` in an empty directory and run
   `sim workflows source create --dir ./wf [--name <name>] [--folder <path>] --yes`. It prints the
   new workflow id and writes the full tree a `get` writes: the `.sim/sdk` types, `tsconfig.json`,
   `.sim/AGENTS.md` and the lock files. Continue with the loop above.

`apply` and `create` ask for confirmation on a terminal; elsewhere pass `--yes` (without it they
refuse with `CONFIRMATION_REQUIRED`). `--dry-run` never asks.

## Where the types live

| Path | Contents |
|------|----------|
| `workflow.ts`, `functions/*` | The source. Edit these. |
| `.sim/lock.json` | Binds each block to its stored id. Renaming a const or a display name keeps the id. Do not edit. |
| `.sim/base.json` | The workflow, workspace, fingerprint and catalog hash the source was read at. Do not edit. |
| `.sim/sdk/core.d.ts` | This package: `workflow`, `t`, `env`, `credential`, `table`, `BlockMeta`, ... |
| `.sim/sdk/blocks/{type}.d.ts` | Every block type's builders, not only the ones in use. |
| `.sim/sdk/operations/{type}/{operation}.d.ts` | One operation's params and outputs, 1-2 KB. Read these to learn a block. |
| `.sim/sdk/workspace.d.ts` | This workspace's tables (with columns), knowledge bases, credentials, workflows (with inputs) and env var names, so `table('tickets')`, `credential('support-slack')` and `env.X` are checked. |
| `tsconfig.json` | Resolves `@sim/workflow-sdk` to `.sim/sdk`. |
| `.sim/AGENTS.md` | The authoring guide for agents, linking [the docs](https://docs.sim.ai/workflows/code). A top-level `AGENTS.md` of your own is never touched. |
| `.gitattributes` | `text eol=lf` for the source files, merged into any file already there. |

`sim workflows source resources <workspaceId>` lists the resource keys source can name.

## Diagnostics

One finding per line, pinned to the file you sent, then the code frame and the hint:

```
workflow.ts:56:7 error E_UNKNOWN_PARAM: Slack has no param chanel.
  54 |     const notify = slack.sendMessage('Notify', {
  55 |       credential: credential('support-slack'),
> 56 |       chanel: 'C0SUPPORT',
     |       ^^^^^^^^^^^^^^^^^^^
  57 |       text: t`New ${classify.category} ticket: ${ticketIn.subject}`,
  hint: Did you mean channel?
```

- `E_*` errors refuse the whole apply; nothing is saved.
- `W_*` warnings are saved as written. They name real problems (a required field left empty, an
  output path no block has), so read them.
- Lock problems print as `.sim/lock.json#/<json path>`.
- The API returns the same findings in `data.diagnostics` (`error.details.diagnostics` on a
  refusal) with `code`, `severity`, `message`, `hint`, `file`, `line`, `column` and `frame`.

Every code and its meaning: SYNTAX.md "Diagnostics".

## Exit codes

| Code | Meaning | Do |
|---|---|---|
| 0 | Applied, or a clean dry run | Done |
| 1 | The source has errors, or the command failed | Fix the printed findings |
| 5 | `SOURCE_STALE`: the workflow changed since `get` | Get again, reapply the edit (step 5) |
| 6 | The workflow is locked | Ask someone to unlock it in the workflow builder |
| 7 | The source is too large | Split function code or remove blocks |

## Write declarations, not programs

The compiler reads the file; it never runs it. So the file holds only what it can read
statically: imports from `@sim/workflow-sdk`, block declarations, and wiring statements. A helper
function, a `for` loop that creates blocks, a conditional, or an import of your own has no stored
form and is refused with `E_UNSUPPORTED_SYNTAX` and a hint naming the supported form. Put the
logic in the graph instead:

```ts
// repeat work over data
const each = loop.forEach('Each lead', { collection: start.leads }, (p) => {
  const save = table.updateRowById('Save', {
    tableId: table('leads'),
    rowId: p.currentItem.id,
    data: { seen: true },
  })
  p.to(save)
})
// choose a path at run time
const route = condition('Route', { billing: js`${cls.category} === 'billing'`, else: true })
// reuse logic
const handoff = runWorkflow('Hand off', { workflowId: childWorkflow('assign-owner') })
```

Write each value where it is used. A param equal to the editor default can be left out.

## Escape hatch: function files

When logic does not fit a block, put it in a function block and keep the code in a file:

```ts
const score = fn('Score lead', { code: codeFile('./functions/score-lead.js') })
```

The file is a function body (top-level `return` and `await` work). In JavaScript, read block
outputs with `$ref.blockKey.path` and environment variables with `$env.NAME`; Python and shell
files are stored verbatim. One file per block; imports between function files are not supported.

## Package layout (for maintainers)

| Path | Contents |
|------|----------|
| `src/core.d.ts` | Authoring types. Exports exactly `SDK_CORE_EXPORTS` from `@sim/workflow-code`; after editing run `bun scripts/generate-core-text.ts`. |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable`. |
| `src/codegen/` | `generateSdkTypes(catalog)` (catalog → `.d.ts`, deterministic, sorted by path) and `generateWorkspaceTypes(manifest)` (`workspace.d.ts`). |
| `test/examples` | Five example workflows, also compiled against the real catalog with zero diagnostics in `apps/sim/lib/workflows/code/sdk-examples.test.ts`. |
| `test/negative` | Code each generated type must reject. |

```bash
bun run test                                   # determinism, locality, evaluator, type-check
bun scripts/typecheck-fixtures.ts <outDir>     # sizes, then tsc over test/examples and test/negative
```
