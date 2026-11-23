# @sim/workflow-sdk

Types for Sim workflows written as TypeScript. A workflow file imports from this package, but
**nothing in it runs**: the server compiles the file statically, and every runtime export throws
`SimSdkNotExecutable`. The guide is [docs.sim.ai/workflows/code](https://docs.sim.ai/workflows/code);
in the Sim repository the full grammar is `packages/workflow-code/src/compile/SYNTAX.md`.

## Edit loop

```bash
sim workflows source get <workflowId> --dir ./wf   # 1. write the source tree
# 2. edit ./wf/workflow.ts (and ./wf/functions/*)
sim workflows source check --dir ./wf              #    compile locally, no request; exit 0 to go on
sim workflows source status --dir ./wf             #    what changed here and on the server; diff shows it
sim workflows source apply --dir ./wf --dry-run    # 3. check on the server; writes nothing
sim workflows source apply --dir ./wf --yes        # 4. save the draft
```

`apply` reads the workflow id from `./wf/.sim/base.json`; pass it (`apply <workflowId> --dir`) to
have the CLI confirm the directory holds that workflow.

1. **Get** writes `workflow.ts`, function files, the lock, the base and the types.
2. **Edit** `workflow.ts`. Declare blocks with `const x = builder('Name', params)` and wire them
   with `x.to(y)`. Then run `sim workflows source check --dir ./wf`: it compiles with the server's
   compiler against the cached catalog, without a request, in milliseconds, and catches what `tsc`
   cannot (duplicate names, cycles, literal secrets). It exits 1 on errors and on the warnings
   `sim workflows source check --help` lists (a missing required field, an unknown option, a
   literal secret and more) in a block the lock does not bind yet (`--strict`: in every block; `--no-strict`: never on a
   warning). It also adds the blocks the source now uses to `tsconfig.json`. Then always run
   `bunx -p typescript@7.0.2 tsc -p ./wf` after an edit and fix what it reports: it takes about a
   second and catches what check and the dry run do not, such as a reference to a start input the
   trigger does not declare. It type-checks with the TypeScript release the declarations are built
   for. `tsconfig.json` includes only the blocks the source used at the
   last check, get or apply (fast); `tsconfig.full.json` includes every current block, from the CLI's cache. A builder of a block
   the directory does not hold yet type-checks once `check` has run: it writes that block's file. In a
   workspace directory, `sim workspaces source check --dir .` checks every workflow against the
   directory's own secrets, credentials, resource keys and table columns, and
   `sim workflows source check` run in a `workflows/<key>` folder does the same for one.
3. **Dry run** compiles and runs every server check. Fix each error it prints, then run it again
   until it exits 0.
4. **Apply** saves the draft. It rewrites `./wf` from what was stored, in canonical form (normalized
   values, order and quoting show up there, so re-read `workflow.ts` before the next edit), and
   refreshes `.sim/lock.json`, `.sim/base.json` and `tsconfig.json`. It deploys only with `--deploy`.
5. **On a 409** (`SOURCE_STALE`, exit 5) the workflow changed since you read it and nothing was
   saved. Run `get` into a fresh directory, reapply your edit there (diff your copy against the old
   source to find it), dry-run, apply. Keep the fresh `.sim/` files: `.sim/base.json` holds the
   fingerprint that makes the next apply safe.
6. **New workflow**: write `workflow.ts` in an empty directory and run
   `sim workflows source create --dir ./wf --workspace <id> [--name <name>] [--folder <path>] --yes`. It prints the
   new workflow id and writes the full tree a `get` writes: the `.sim/sdk` types, `tsconfig.json`,
   `.sim/AGENTS.md` and the lock files. Continue with the loop above. Run on a directory without
   `workflow.ts` and without `--dry-run` or `--yes`, `create --dir ./wf --workspace <id>` writes a
   starter `workflow.ts` and that workspace's types instead, records the workspace in
   `.sim/starter.json`, and creates nothing; the create that follows targets that workspace, and
   one into another workspace is refused unless `--workspace` names it.

`apply` and `create` ask for confirmation on a terminal. With no terminal to ask and no `--yes`,
they print the plan, write nothing and exit `14` (or `1` when the plan has errors): run the same
command with `--yes` to write it. `--dry-run` never asks.

## Where the types live

| Path | Contents |
|------|----------|
| `workflow.ts`, `functions/*` | The source. Edit these. |
| `.sim/lock.json` | Binds each block to its stored id. Renaming a display name keeps the id; renaming the const too keeps it only when settings, neighbours or references still tie the block. Do not edit. |
| `.sim/base.json` | The workflow, workspace, fingerprint and catalog hash the source was read at. Do not edit. |
| `.sim/written.json` | The CLI's record of each file as it last wrote it, so `status`, `diff` and a later `get` can tell your unapplied edits from files it may replace. Commit it with the lock and base. Do not edit. |
| `.sim/sdk/core.d.ts` | This package: `workflow`, `t`, `env`, `credential`, `table`, `BlockMeta`, ... |
| `.sim/sdk/INDEX.md` | The block type → builder naming rule, how a workflow runs, and one line per builder of the blocks the directory holds: `slack.sendMessage — Slack: Send Message → blocks/slack_v2.d.ts (SlackSendMessageParams)`. Any other builder: `sim workflows source params <builder>`. |
| `.sim/sdk/blocks/{type}.d.ts` | One block type's builders with their params and outputs, for the blocks the source uses and the core builders' (`check` adds a block an edit starts using). `sim workflows source params` prints one builder rather than a file whole. |
| `.sim/sdk/index.d.ts` | Names the catalog and generator the declarations come from, and imports the blocks the directory holds. |
| `~/.sim/cache/source-catalog/<hash>/sdk-<generator>/` | Every block's declarations and the full `INDEX.md`, generated once per catalog and shared by every directory; `tsconfig.full.json` includes its `index.d.ts` (every current block). |
| `.sim/sdk/workspace.d.ts` | This workspace's tables (with columns), knowledge bases, credentials, workflows (with inputs), skills, custom tools, MCP servers (with tools) and env var names, so `table('tickets')`, `credential('support-slack')`, `skill('triage')` and `env.X` are checked. |
| `tsconfig.json` | Resolves `@sim/workflow-sdk` to `.sim/sdk` and type-checks `workflow.ts` with the blocks it uses (from the source and the server's `blockTypes`) and the core builders' blocks: a few dozen files for `tsc` instead of every block. |
| `tsconfig.full.json` | The same with every current block (the cached index, an absolute path on this machine), plus any legacy-only block the workflow uses. |
| `.sim/AGENTS.md` | The authoring guide for agents: the primer `get` prints (edit loop, identity, references, deletes, deploy, exit codes, and a snippet for each builder the source calls), then a reference linking [the docs](https://docs.sim.ai/workflows/code). A top-level `AGENTS.md` of your own is never touched. |
| `.sim/examples/*.ts` | Example workflows, together one correct example of each common block: `cookbook.ts` (agent, condition, function, table, knowledge, Slack, human in the loop, loop, response), `integrations.ts` (webhook, weekday cron, HTTP headers, table update by id, Gmail, `onError`), `agents.ts` (router, agent tools, child workflow, parallel). Read them before writing. They name example resources, so the tsconfig files leave them out. |
| `.gitattributes` | `text eol=lf` for the source files, merged into any file already there. |

`sim workflows source resources` lists the resource keys source can name in the active
workspace (`-w <workspaceId>` for another).

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

Every code and its meaning: the "Diagnostics" table of `SYNTAX.md` in the Sim repository.

## Exit codes

Every `sim workflows source` and `sim workspaces source` command exits with one of these:

| Code | Meaning | Do |
|---|---|---|
| 0 | Applied or created, a dry run or check with no errors, or a clean status | Done |
| 1 | The source has errors, a locked block (`E_APPLY_LOCKED_BLOCK`), a name another workflow holds (`SOURCE_NAME_TAKEN`), a cancelled prompt, or the command failed | Fix what it printed |
| 5 | `SOURCE_STALE`: the workflow changed since `get`, and nothing was written | Get again, reapply the edit (step 5) |
| 6 | The workflow or its folder is locked (`E_APPLY_LOCKED`) | Ask someone to unlock it in the workflow builder |
| 7 | The source is too large (on a get, status or diff too) | Split function code or remove blocks |
| 8 | `sim workspaces source apply` stopped part-way; what was written is saved into the directory | Apply again until it exits 0 |
| 9 | Still rate limited (HTTP 429) after the CLI's retries; nothing more was written | Wait a minute and run the same command again |
| 10 | Busy: another apply is writing the workspace, or another `sim` command is using the directory; nothing was written | Run it again once the other finished |
| 11 | `status`: only your local edits | Dry-run, then apply |
| 12 | `status`: the server changed since the get (drift, or a conflict with your edits) | Follow the `Next:` line it prints |
| 13 | Not logged in, or the server refused the credential (`AUTH_REQUIRED`); nothing was sent | `sim login`, or fix or unset `SIM_API_KEY` |
| 14 | `apply` or `create` without `--yes` and no terminal to ask: it printed the plan, found no errors, and wrote nothing | Run the same command with `--yes` |
| 15 | `sim workspaces source apply` (or `--to`) wrote part of its plan and held the rest back: a change that uses a declared secret with no value, or a credential key nothing binds to | Set the secret or connect the credential, then apply again |
| 130 | Interrupted (Ctrl-C). An apply or create already sent is finished and saved first, waiting up to 60s for its answer; a second Ctrl-C, or no answer by then, stops at once and says it may have been written | `sim workflows source status --dir ./wf` |

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
| `src/core.d.ts` | Authoring types. Exports exactly `SDK_CORE_EXPORTS` from `@sim/workflow-code`; after editing run `bun run generate:workflow-sdk-embedded-text` from the repository root (`check:workflow-sdk-embedded-text`, part of `bun run check:audits`, fails when it is stale). |
| `cookbook/examples/*.ts` | The examples the CLI writes into `.sim/examples/`. After editing run `bun run generate:workflow-sdk-embedded-text`; `apps/sim/lib/workflows/code/real-catalog.test.ts` type-checks and compiles each against the real catalog (its `COOKBOOK_WORKSPACE` lists the resources they name). |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable`. |
| `src/codegen/` | `generateSdkTypes(catalog, { blockTypes })` (catalog → `.d.ts` and the `INDEX.md` builder list, for every block or a directory's subset, deterministic, sorted by path), `describeBuilder`/`lookupBuilder` (one builder's params and outputs, for `sim workflows source params`), `generateWorkspaceTypes(manifest)` (`workspace.d.ts`), and `layout.ts`: which declaration files a directory's tsconfig files include. |
| `test/examples` | Five example workflows, also compiled against the real catalog with zero diagnostics in `apps/sim/lib/workflows/code/sdk-examples.test.ts`. |
| `test/negative` | Code each generated type must reject. |

```bash
bun run test                                   # determinism, locality, evaluator, type-check
bun scripts/typecheck-fixtures.ts <outDir>     # sizes, then tsc over test/examples and test/negative
```
