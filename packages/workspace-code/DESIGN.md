# @sim/workspace-code: design

Workspace source is a directory that declares a workspace's resources as files, which
`sim workspaces source get` writes and `sim workspaces source apply` sends back. This package holds
the pure half: the directory layout, one codec per resource kind, the base file and fingerprints.
It has no I/O and no ids, like `@sim/workflow-code` (`packages/workflow-code/DESIGN.md`), which
owns everything inside a single workflow. The server half is `apps/sim/lib/workspace-source/`.

## Directory

```
secrets.ts      secret names and descriptions (secret; never a value)
credentials.ts  credential keys and providers (credential; never a token)
tools/      custom tools      (custom-tool)
skills/     skills            (skill)
mcp/        MCP servers       (mcp-server; headers hold env references, never secrets)
tables/     table schemas     (table; `<key>.rows.jsonl` beside one that opts its rows in)
knowledge/  knowledge bases   (knowledge-base; documents are blobs)
files/      workspace files   (file; every file is a blob)
workflows/  one workflow source directory per folder (workflow)
deployments/ one deployment per workflow key (deployment; applied after workflows)
.sim/base.json     what the server held at the last get or apply (WorkspaceBaseV1)
.sim/skipped.json  what a get left out (over a limit, or an unrepresentable name)
.sim/written.json  CLI bookkeeping: what the CLI last wrote, so unchanged files need not be sent
```

`KIND_DIRS` (`src/kind.ts`) maps each kind to its folder, or for a kind one root file declares
whole (`FILE_KINDS`: secrets, credentials) to that file, each entry of it one resource. A kind is
managed only when its folder or file exists (or `--only` names it), so a directory can hold a
subset of the workspace. `APPLY_ORDER` is
the order writes run in: a resource exists before anything that references it. Deletes run in
reverse.

## Kinds

A kind has two halves:

- **Codec** (here, `src/kinds/<kind>.ts`): `KindLayout` (how paths group into resources, which
  paths are blobs, what a key names, which byte budget the text counts against) plus `KindCodec<D>`
  (`parse` files → declaration, `print` declaration → files, `canonical` declaration → id-free
  JSON). `KIND_LAYOUTS` (`src/kinds/registry.ts`) is the total registry the server and the CLI
  read layouts through. `BLOB_KIND_CODECS` holds the codecs of the kinds with blobs, so the CLI
  fingerprints a blob kind exactly as the server does. The table codec needs the server's column
  type catalog, so only its layout lives in the registry (`createTableCodec` takes the catalog).
- **Adapter** (server, `apps/sim/lib/workspace-source/application/kinds/<kind>/adapter.ts`):
  `KindAdapter` (`application/types.ts`) with `load`, `plan`, `authorize`, `fingerprintNow`,
  `apply` and `read`. Every protected read and write goes through the use case that owns the
  resource, so its authorization, audit and notifications apply unchanged. `KIND_ADAPTERS`
  (`application/registry.ts`) is the total registry. Tools and skills share `kinds/named.ts`.

## Keys and the base

A resource is named by a persisted key (`workspace_resource_key`,
`apps/sim/lib/workspaces/resource-keys.ts`), allocated from its name the first time a get needs
it and never changed after. The same key is how a workflow names the resource
(`table('leads')`). A workspace file is keyed by its path instead (`keys: 'path'`) and has no key
row.

`.sim/base.json` (`src/base.ts`, `parseWorkspaceBase`) binds each `kind:key` address to its id, a
table's column keys to column ids, a blob to its id, revision and hash, and records each
resource's fingerprint as the last get or apply saw it. Workflows keep their own per-folder
`.sim/lock.json` and `.sim/base.json`; the root base only records each workflow's id (and a
fingerprint that guards a delete).

A get binds a key to every stored resource (`allocate`). An apply never allocates, so a resource
no source has named yet can be **adopted** by a declaration of the same name. A write claims its key
only after it succeeds (`claimKey`), so a failed write leaves the key free and the next apply
adopts the resource.

A key never changes: a declaration whose file was renamed (the base read the same resource under
the old key, which the directory no longer declares) is `E_KEY_RENAMED`, and the resource is not
deleted. A workflow still names a workspace file by its resource key (`file('report-pdf')`), not
its path: a file an apply creates claims the key a get would first allocate it, so a workflow of
the same apply resolves it.

## Fingerprints and the three-way rule

A resource's fingerprint is `fingerprintOf(canonical(decl))` = `rf1:` + SHA-256 of the canonical
JSON's stable stringification (`src/fingerprint.ts`). Every kind decides a declared resource with
one rule (`application/three-way.ts`), from its fingerprint in the directory (local), in the base,
and on the server now:

| local vs base | server vs base | outcome |
|---|---|---|
| equal | any | `noop` (`I_SERVER_CHANGED` when the server drifted) |
| differs | equal | `apply` |
| differs | differs | `noop` if local equals server (base refreshed), else `stale` |

With no stored resource under the key: a resource the base records but the server no longer holds
was deleted there and stays deleted; otherwise an unbound resource of the same name is adopted,
else one is created. A stored resource with no base entry is a no-op when it matches exactly and
`no-base` (get first) otherwise.

Undeclared resources (`planUndeclared`, `application/findings.ts`): only one the base records is
deleted, and only with `--allow-delete`; anything else is kept and named in a warning. The same
flag passes through to each workflow folder's apply, which refuses deleting a block without it
(`E_APPLY_BLOCK_DELETE`).

**`canonical()` is load-bearing.** A field missing from it fingerprints an edit as equal to the
base, so the rule calls it `noop` and drops the edit with no finding. Every declared field must
appear in the reader, the printer and `canonical()`, and a fixture in the kind's test must set it.

**Changing canonical output breaks every checkout.** Any change to a kind's `canonical()` (or to
`@sim/workflow-code` canonicalize, for workflows) changes stored fingerprints, so every directory
in the field reads as changed or stale after the deploy. Treat it as a format change: bump the
`rf`/`sf` prefix and accept the old one for a release, or ship it with a note to re-run get.

### The workflow kind

Each `workflows/<key>/` folder is a workflow source directory applied through the single-workflow
pipeline (`applyWorkflowSource`, `createWorkflowFromSource`), so compile, gates, the lock, the 409
and audit are a single apply's. It deviates on purpose (see the header of
`kinds/workflow/adapter.ts`): an edited folder is checked against its own `.sim/base.json`, and a
folder sent unchanged (`isUnchanged`) is a no-op with no drift check, because telling whether a
workflow drifted means canonicalizing every stored workflow on every apply. When several folders
are sent whole (a directory without the CLI's bookkeeping), one batched read finds those that print
exactly as their stored workflows at their base's fingerprint, and those are no-ops too, never
evaluated. Every new folder gets its workflow id at plan time, so new folders that run each other
resolve in any order, cycles included. A folder's `workflow('…')` name and description rename the
workflow.

### Table rows

A table's rows stay out of source unless its declaration opts in with `rows`
(`kinds/table-rows.ts`, server half `kinds/table/rows.ts`); they live in
`tables/<key>.rows.jsonl`, one JSON object per line keyed by column key, a select cell by option
name, at most `maxTableRows` per table and `maxRowsBytes` across the directory (their own budget,
apart from the declarations').

- `{ mode: 'seed' }` writes the rows into a table the apply creates, or adopts while it holds no
  rows and the base has no entry for it (`I_TABLE_SEED_SKIPPED` otherwise). Seed rows are outside
  every fingerprint, and a get never prints them.
- `{ mode: 'managed', key }` makes the file the table's whole content, each row matched to its
  stored row by the unique `key` column. The table's `canonical()` carries only `{ mode, key }` (so
  tables without managed rows fingerprint as before); the rows have their own fingerprint
  (`tableRowsFingerprint`), which `base.rows` records with the table's `rows_version` at the last get
  or apply. A plan reads the stored rows only when the directory's rows differ from the base, then
  applies the three-way rule to the rows alone: equal to the server's is a no-op that refreshes
  `base.rows`; the server's changed from the base is `E_APPLY_STALE`; else the rows are written. A
  write records the row version the plan read in its fingerprint, so the apply's pre-write check
  refuses a version that moved. Rows the file no longer lists are deleted only with
  `--allow-delete`. The server marks a managed table in its metadata (`sourceRows`, by key column id),
  so a get prints the declaration's `rows` and the rows file.

Every rows write is the table's one reshape (`reshapeTableUseCase`, `rows` and `sourceRows`):
columns, the managed mark and the rows commit in one transaction. Managed rows are a keyed diff
(`writeKeyedRowsWithTx`, `apps/sim/lib/table/rows/keyed-write.ts`) through the row service's
transaction-bound writers: stored rows whose key the file no longer lists are deleted (a renamed key
is a delete and an insert), rows whose declared cells changed are patched, leaving other columns'
cells (a workflow group's outputs) alone, and new keys are inserted. An unchanged row is never
written, so its id, `updated_at`, run state and provenance stay and no table trigger fires for it;
the triggers of the rows written fire once the reshape commits. A column added `required` is added
optional, filled by the rows, then made required in the same transaction, so a directory can add a
required column and its values in one apply.

### The MCP server kind

`mcp/<key>.ts` declares a server the workspace consumes (`kinds/mcp.ts`, adapter
`kinds/mcp/adapter.ts`). Its id derives from its URL, so the URL is its identity: an unbound
server at the declared URL is adopted, and a changed URL replaces it (created at the new URL, the
old one deleted; `--allow-delete` when stored workflows call it). A header value is stored text in
which `{{NAME}}` names an env variable (`env.NAME` in source); a credential header holding literal
text is `E_MCP_LITERAL_SECRET`, and a get prints one as `stored()`, which the server fingerprints
by a keyed hash of the value it holds. After every kind is planned, the adapter's `checkRefs`
lists each server's tools through the discovery use case and checks the tools workflows call
(`refs` with a `member`): an unknown one is `E_MCP_TOOL_UNKNOWN`, a server it cannot list
(unreachable, created by this apply, a workspace API key) `W_MCP_TOOLS_UNCHECKED`.

### Reference kinds: secrets and credentials

`secrets.ts` and `credentials.ts` declare what workflows reference without holding a value, and an
apply never creates or deletes what they name. A secret entry may update its description
(`setSecretUseCase`, description only); a credential entry binds its key to this workspace's
credential of its provider (kept when bound, else the only fitting one no other declared key holds,
narrowed by `name`), and removing one unbinds the key only with `--allow-delete`. An entry the
workspace cannot satisfy (no secret of that name; no credential, or several, to bind) is a warning
on the file and sets `PlannedChange.unavailable`: the plan then **holds back** every write whose
`refs` name it (a workflow's `refs` carry its credential keys and the env names it reads), and every
write that names a held one, with an error on each (`E_SECRET_MISSING`, `E_CREDENTIAL_*`,
`E_PLAN_REF_HELD`). Held changes are not written and their errors do not refuse the rest
(`WorkspacePlan.refused`); this is the one exception to "any error refuses the whole apply". A get
prints every workspace secret (never a personal one) and every credential the caller's listing
shows, so the same files apply back unchanged; applied to another workspace, each key binds to that
workspace's own credential. Findings about these files carry no code frame, so a value written into
one by mistake is never echoed back.

### The deployment kind

`deployments/<key>.ts` deploys `workflows/<key>/` (`kinds/deployment/adapter.ts`): a folder of its
own because deploying needs a workspace admin and refuses a workspace API key, while a workflow
edit needs write, and `workflows/<key>/` stays a single-workflow directory. It is keyed by the
workflow's key and claims none (`WORKSPACE_KIND_SPECS[kind].resourceKind` is `null`); its base id
is the workflow's id. The three-way rule covers what the server stores (public API, chat); `live`
is outside the fingerprint and read on every apply against the server's `needsRedeployment`:
`'draft'` deploys when the apply edits the workflow or the draft already differs, `'pinned'` never
redeploys and reports `I_DEPLOY_DRAFT_NOT_LIVE`. A deploy's idempotency key hashes the deployment's
fingerprint and the live version it replaces. A chat password is `env.NAME` (resolved at apply,
never stored in source) or `stored()`; the base records the variable under `x-passwordEnv`, since
the server keeps only the encrypted value. Removing the file undeploys (`--allow-delete`), and the
plan counts what stops. Whether or not the kind is managed, an apply that edits a deployed workflow
no deployment file covers warns `W_DEPLOYED_DRAFT_CHANGED`. MCP publishing is not part of source.

## Plan and apply

`planWorkspaceSource` (`application/plan.ts`) writes nothing: read the base, parse every managed
kind's files, load what is stored, let each kind plan in apply order (so a dry run of a later kind
resolves keys an earlier kind creates), check references across kinds, authorize every change, and
cap the plan. Any error refuses the whole apply before the first write, so the plan refuses what
a write would refuse: a delete of a locked resource (`E_APPLY_LOCKED`), of one a stored workflow
still uses (`E_PLAN_REF_DELETED` for a declared caller, `W_RESOURCE_IN_USE` for one outside the
directory, workflows included), and a table change whose data breaks a new column rule. A plan
reports at most 1000 findings, errors first, then warnings, then infos, and an info counts the
rest, so cutting findings never refuses a plan.

`applyWorkspaceSource` (`application/apply-workspace-source.ts`) then writes each change through
its use case, deletes last and in reverse order. A change whose plan recorded a fingerprint
re-reads it first and refuses one that moved (`E_APPLY_STALE`). Writes commit one by one: a
failure stops the apply and reports what was written before it (`failed`); the CLI saves that
progress back into the directory and exits 8 (`SOURCE_PARTIAL_EXIT_CODE`). Re-running the same
directory converges.

**Blob rounds.** The text and the blob manifest (path, hash, size) travel in every request; blob
bytes travel only when the server asks for them (`needBlobs`), at most
`maxBlobBytesPerRequest` per round (`roundPaths`, `src/limits.ts`). A change waits for a later
round while its blobs are missing; a delete waits while any blob is missing, so a resumed apply
never deletes early.

## Limits

`WORKSPACE_SOURCE_LIMITS` (`src/limits.ts`) is shared by get and apply: a get leaves out what an
apply would refuse and lists it in `.sim/skipped.json`, so anything a get writes applies back
unchanged. One workflow keeps its own `SOURCE_LIMITS` (`@sim/workflow-code/limits`).

## Versions

`.sim/base.json` carries `version: 1`. As with the workflow lock, adding an optional field does not
bump the version: validators learn a field before writers emit it, and data waits under an `x-` key,
which the parser tolerates and preserves. Nothing upgrades an older version yet; a bump is a hard
refusal until a migration is written.

## SDK and CLI

- `@sim/workflow-sdk` declares the directory for editors: `src/workspace/*.d.ts` (one per kind) and
  `src/codegen/workspace.ts` (`generateWorkspaceTypes`, which types `table('k')` rows from a
  `WorkspaceManifest`, and `env.NAME` and `credential('k')` from `secrets.ts` and
  `credentials.ts` live, through `typeof import(...)`, so a declared but unapplied entry
  type-checks). The CLI embeds them through
  `packages/workflow-sdk/scripts/generate-embedded-text.ts`; the `*-text.test.ts` drift tests fail
  until it is re-run.
- The CLI side is `packages/sim-cli/src/commands/protocol/workspace-source-*.ts`.
  `workspace-source-dir.ts` writes the directory's `tsconfig.json` (`TSCONFIG`), the agent guide
  (`AGENTS_GUIDE`) and the local declarations a get types (`localDeclarations`).
- `cookbook/workspace/` in the SDK package is the example directory.

The steps for adding a kind are in `.claude/rules/sim-workflow-code.md`.
