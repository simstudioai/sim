# @sim/workflow-sdk

The authoring surface for Sim workflows written as TypeScript. A workflow file imports from this
package, but **nothing in it ever runs**: the server compiles the file statically, and every
runtime export throws `SimSdkNotExecutable`.

## Editing a workflow (for agents)

```bash
sim workflows source get <workflowId> --out ./wf      # write the source tree
# edit ./wf/workflow.ts (and ./wf/functions/*)
tsc -p ./wf                                           # optional: type-check locally
sim workflows source apply <workflowId> --from ./wf --dry-run   # check, write nothing
sim workflows source apply <workflowId> --from ./wf --yes       # save the draft
```

To create a workflow instead, write `workflow.ts` in an empty directory and run
`sim workflows source apply --new --from ./wf [--name <name>] [--folder <path>] --yes`; it prints
the new workflow id and writes the lock files back into the directory.

- Every file starts with `// @sim-sdk 1`, then imports from `@sim/workflow-sdk`.
- `apply` asks for confirmation on a terminal. Anywhere else pass `--yes` (it exits 2 without it).
  `--dry-run` never asks.
- Apply only ever changes the draft. Deploy separately.
- Keep `.sim/lock.json` and `.sim/base.json`: they bind each block in the file to its stored id.
  Renaming a block's const or display name keeps its id; deleting the lock does not.

## What `--out` writes

| Path | Contents |
|------|----------|
| `workflow.ts`, `functions/*` | The source. Edit these. |
| `.sim/lock.json`, `.sim/base.json` | Identity lock and the fingerprint the source was read at. Do not edit. |
| `.sim/sdk/core.d.ts` | This package's authoring types (`BlockMeta`, `t`, `env`, `table`, `binding`, ...). |
| `.sim/sdk/blocks/{type}.d.ts` | One file per block type with its builders: every block, not only the ones in use. |
| `.sim/sdk/operations/{type}/{operation}.d.ts` | One operation's params and outputs, about 1-2 KB each. Read these to learn a block. |
| `.sim/sdk/workspace.d.ts` | This workspace's tables (with columns), knowledge bases, credential bindings, workflows (with inputs) and env var names, so `table('tickets')`, `binding('support-slack')` and `env.X` are checked. |
| `tsconfig.json` | Resolves `@sim/workflow-sdk` to `.sim/sdk`. |
| `AGENTS.md` | A pointer to this README. |

The block declarations come from the workspace's block catalog, cached by ETag in the CLI's config
directory, so a second `get` in the same workspace does not download it again.

## Diagnostics

`apply` prints one finding per line, pinned to the file you sent:

```
workflow.ts:12:5 error E_UNKNOWN_PARAM: Slack has no param credential.
  11 |     const notify = slack.sendMessage('Notify', {
> 12 |       credential: binding('support-slack'),
     |       ^^^^^^^^^^
  13 |       channel: 'C0SUPPORT',
  hint: Write it as oauthCredential; the value kind picks the basic or advanced field.
```

The format is `file:line:column severity CODE: message`, then the source frame, then the hint.
Errors (`E_*`) refuse the whole apply and nothing is saved. Warnings (`W_*`) are saved as written;
they name real problems (a required field left empty, an output path no block has), so read them.
The API returns the same findings in `data.diagnostics` (or `error.details.diagnostics` when the
apply is refused) with `file`, `line`, `column`, `code`, `severity`, `message` and `hint`.

## When the apply answers 409 (`SOURCE_STALE`)

Someone changed the workflow since you read it. Nothing was saved. Rebase:

1. `sim workflows source get <workflowId> --out ./wf-fresh`.
2. Re-apply your edit to `./wf-fresh/workflow.ts` (diff your copy against the old source to find
   it), then `apply --from ./wf-fresh --dry-run`, then apply.

Never copy the old `.sim/` files over the fresh ones: the fingerprint in `.sim/base.json` is what
makes the next apply safe.

## Package layout (for maintainers)

| Path | Contents |
|------|----------|
| `src/core.d.ts` | Authoring types. It exports exactly `SDK_CORE_EXPORTS` from `@sim/workflow-code`; after editing it run `bun scripts/generate-core-text.ts` |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable` |
| `src/codegen/` | `generateSdkTypes(catalog)` (block catalog → `.d.ts`) and `generateWorkspaceTypes(manifest)` (`workspace.d.ts`) |

`generateSdkTypes` is deterministic (same catalog, byte-identical files sorted by path). Builder
names come from the catalog's frozen `builders` map. Param names are subBlock ids, or the
`canonicalParamId` of a basic/advanced pair, narrowed per operation by the visibility evaluator.

```bash
bun run test                                   # determinism, locality, evaluator, type-check
bun scripts/typecheck-fixtures.ts <outDir>     # sizes, then tsc over test/examples and test/negative
```

`test/fixtures/catalog.json` is projected from 18 real registry blocks; `test/examples` are five
example workflows (also compiled against the real catalog with zero diagnostics in
`apps/sim/lib/workflows/code/sdk-examples.test.ts`), and `test/negative` holds code each generated
type must reject.
