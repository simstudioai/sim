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
  `KindAdapter` (`application/types.ts`) with `load`, `plan`, `authorize`, `storedFingerprintNow`,
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
no source has named yet can be **adopted** by a declaration of the same name. The directory never
read that resource, so an adopt may only add to it (`refuseUnreadAdopt`): it binds the key when
the declaration matches, and adds what the resource lacks (a column, rows into an empty table, a
knowledge base document); one that would change or remove anything the resource holds is
`E_APPLY_NO_BASE` (get it first), even with `--allow-delete`. A write claims its key only after it
succeeds (`claimKey`), so a failed write leaves the key free and the next apply adopts the
resource, finishing what the write left.

A key never changes: a declaration whose file was renamed (the base read the same resource under
the old key, which the directory no longer declares) is `E_KEY_RENAMED`, and the resource is not
deleted. A workflow still names a workspace file by its resource key (`file('report-pdf')`), not
its path: a file an apply creates claims the key a get would first allocate it, so a workflow of
the same apply resolves it.

A table's column keys persist with the table too: every table write records each declared column
whose key is not its name in `metadata.sourceColumnKeys` (column id → key), and a read prints a
column under the base's binding, else that record, else its name. So a fresh get, and the target's
read in a promotion, print the key the declaration gave the column (also after a rename in Sim), and
a promotion's managed rows match the stored ones by the same keys. An apply that finds a column a
read would print under another key records the keys alone (`fields: ['column keys']`).

## Fingerprints and the three-way rule

A resource's fingerprint is `fingerprintOf(canonical(decl))` = `rf1:` + SHA-256 of the canonical
JSON's stable stringification (`src/fingerprint.ts`). Every kind decides a declared resource with
one rule (`application/three-way.ts`), from its fingerprint in the directory (local), in the base,
and on the server now:

| local vs base | server vs base | outcome |
|---|---|---|
| equal | any | `noop` (`W_SERVER_CHANGED` when the server drifted) |
| differs | equal | `apply` |
| differs | differs | `noop` if local equals server (base refreshed), else `stale` |

With no stored resource under the key: a resource the base records but the server no longer holds
was deleted there and stays deleted; otherwise an unbound resource of the same name is adopted
(adding to it only, see above), else one is created. A stored resource with no base entry is a no-op when it matches exactly and
`no-base` (get first) otherwise.

Undeclared resources (`planUndeclared`, `application/findings.ts`): only one the base records is
deleted, and only with `--allow-delete`; anything else is kept and named in a warning. The same
flag passes through to each workflow folder's apply, which refuses deleting a block without it
(`E_APPLY_BLOCK_DELETE`).

**`canonical()` is load-bearing.** A field missing from it fingerprints an edit as equal to the
base, so the rule calls it `noop` and drops the edit with no finding. Most kinds declare their
fields in one `DeclFields` table (`declaration/field-table.ts`) that the reader, the printer and
`canonical()` all walk, so tsc refuses a field without an entry; only a tool's `code` and a
skill's `content` are handled by hand. A fixture in the kind's test must set every field.

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
  every fingerprint, and a get never prints them: they are the directory's. The table's
  `metadata.sourceRows` records `{ mode: 'seed' }`, so a get prints the declaration's `rows` and
  the CLI keeps the rows file it finds beside it (`seedRowsFiles`), and a promotion from a
  re-read directory still seeds the tables it creates.
- `{ mode: 'managed', key }` makes the file the table's whole content, each row matched to its
  stored row by the unique `key` column. The table's `canonical()` carries only `{ mode, key }` (so
  tables without managed rows fingerprint as before); the rows have their own fingerprint
  (`tableRowsFingerprint`), which `base.rows` records with the table's `rows_version` at the last get
  or apply. A plan reads the stored rows only when the directory's rows differ from the base, then
  applies the three-way rule to the rows alone: equal to the server's is a no-op that refreshes
  `base.rows`; the server's changed from the base is `E_APPLY_STALE`; else the rows are written. A
  write records the row version the plan read in its fingerprint, so the apply's pre-write check
  refuses a version that moved. Rows the file no longer lists are deleted only with
  `--allow-delete`. A stored row whose key cell is empty (the grid's "add row" makes one) has
  nothing a line could match it by, so it is not managed: a get leaves it out of the file with
  `I_TABLE_ROWS_UNKEYED`, neither fingerprint counts it, and no rows write changes or removes it
  (a column made required still counts its empty cells). The base records the rows under the key
  the server marks, so a plan that changes `key` compares the server with the base under that one. The server marks a managed table in its metadata (`sourceRows`, by key column id),
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

### Knowledge documents

A document is never edited in place (the knowledge use cases have no such write), so a changed
document is replaced: the replacement is uploaded under a name that names the old document
(`.sim-replace.<old id>.<name>`), takes the old one's tag values, the old one is deleted, and the
replacement is renamed. Each step is one write, so a replace that stops between them leaves a
replacement only source could have made: the next apply that changes the knowledge base finishes
it when it holds the declared bytes, or removes it and replaces again (the directory edited since),
and a get reports it (`I_KB_REPLACE_UNFINISHED`). A replacement left before its rename stands for
its name meanwhile; one left before the delete does not.

### The MCP server kind

`mcp/<key>.ts` declares a server the workspace consumes (`kinds/mcp.ts`, adapter
`kinds/mcp/adapter.ts`). Its id derives from its URL, so the URL is its identity: an unbound
server at the declared URL is adopted, and a changed URL replaces it (created at the new URL, the
old one deleted; `--allow-delete` when stored workflows call it). A replace that stopped partway
resumes: the server it created holds exactly the declaration and no key, so the next apply adopts
it, deleting the old one if it is still there; a different server already at the new URL is
`E_NAME_TAKEN`. A header value is stored text in
which `{{NAME}}` names an env variable (`env.NAME` in source); a credential header holding literal
text is `E_MCP_LITERAL_SECRET`, and a get prints one as `stored()`, which the server fingerprints
by a keyed hash of the value it holds. A get by a member who may not rewrite headers prints every
literal value as `stored()`; the server resolves such a header to the value it holds, so the
directory applies back unchanged. After every kind is planned, the adapter's `checkRefs`
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
redeploys and reports `I_DEPLOY_DRAFT_NOT_LIVE`. `'draft'` publishes only a draft the directory
vouches for: the one this apply's workflow write stored, or one that still prints as the workflow
folder's base. A draft holding edits made outside source is not deployed
(`W_DEPLOY_DRAFT_NOT_SOURCE`; a chat write, which would deploy it, is `E_DEPLOY_DRAFT_NOT_SOURCE_CHAT`),
and every deploy, and every chat write (which redeploys a draft that differs), names the vouched
draft's `sf1:` fingerprint (`expectedDraftFingerprint`), so a draft edited between the plan and the
write is refused as stale rather than published. A deploy's idempotency key hashes the deployment's
fingerprint and the live version it replaces. The flag, the deploy and the chat are separate writes, so the
apply checks what the chat write refuses (an identifier another chat holds,
`E_DEPLOY_CHAT_IDENTIFIER`, at plan time and again before the first write; the password, the
outputs, the auth mode) before it writes any of them. The base records each part's fingerprint
(`x-parts`: `api`, `chat`), so a re-run after an apply stopped between them finds every part
either the base's or the directory's and finishes the write (`partway` in `three-way.ts`), while a
part that matches neither is still `E_APPLY_STALE`. A first deploy that stopped before its chat leaves a deployment with no
base entry: when it holds the declared flag and no chat (or the declared one), the next apply
finishes it instead of answering `E_APPLY_NO_BASE`. A chat password is `env.NAME` (resolved at apply,
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
directory, workflows included), and a table change whose data breaks a new column rule. A column
rename warns `W_TABLE_COLUMN_RENAMED_IN_USE` on each Table block of a stored workflow that still writes,
filters or sorts by the old name (the run drops it), at the line of the declared workflow's file; an
edited workflow folder is checked by its own lint against the declared columns instead. A plan
reports at most 1000 findings, errors first, then warnings, then infos, and an info counts the
rest, so cutting findings never refuses a plan.

`applyWorkspaceSource` (`application/apply-workspace-source.ts`) then writes each change through
its use case, deletes last and in reverse order. A change whose plan recorded a fingerprint
re-reads it first and refuses one that moved (`E_APPLY_STALE`). Writes commit one by one: a
failure stops the apply and reports what was written before it (`failed`); the CLI saves that
progress back into the directory and exits 8 (`SOURCE_PARTIAL_EXIT_CODE`). Re-running the same
directory converges.

**One apply at a time.** A write's re-read and the write itself are separate statements, and a
knowledge base's write spans many transactions (one per document), so an apply holds a
per-workspace lease row (`workspace_source_apply_lease`, `lib/workspace-source/lease/store.ts`)
from before it plans until its last write. Taken only for the writes, a plan made before another
apply's writes would write half of itself and then fail (a name taken, a resource changed, a
delete another apply started using). A second apply meanwhile is refused before it reads
anything, with nothing written: `409` with `details.code`
`SOURCE_BUSY`, CLI exit 10 (`SOURCE_BUSY_EXIT_CODE`). A dry run takes no lease. It is a row, not a
Postgres advisory lock: a transaction lock cannot span the write phase's transactions, and a
session lock does not survive PgBouncer transaction pooling. The apply renews it in the background
while it plans and writes, and checks it is still held before each write; a process that dies stops renewing, and the lease
lapses after two minutes. The lease orders applies, not UI edits: a UI write between a re-read and
the write is still caught only where the child use case takes a precondition (a file's
`expectedRevision`, a workflow's fingerprint under its row lock).

**Staged blobs.** Blob bytes never travel in an apply. A client first asks which of the blobs it
will send it has not staged (`POST /source/blobs/missing`, by SHA-256 and size), uploads only
those (`POST /source/blobs`, multipart, one part per blob named by its hash, at most
`maxBlobBytesPerRequest` per request framing included, a larger blob alone, `stageBatches` in
`src/limits.ts`; every body stays under the 10 MiB Next.js proxy ceiling, past which the route
would receive a truncated body, and the route answers a larger one `413 PAYLOAD_TOO_LARGE`), then sends one apply
whose manifest names each blob by path, hash and size. The server checks every uploaded part
against its hash before staging it, so a staged blob is verified bytes. The plan resolves the
blobs its writes need against the staging area once, before any write: a missing one (never
staged, expired, or staged at another size) refuses the whole apply with `E_BLOB_MISSING`, and a
dry run lists such paths in `needBlobs` instead. Writes then read each blob from staging one at a
time (rechecking its hash). An apply never deletes what it read: staged blobs are reclaimed only
by expiry, a day after each was last staged (asking for or planning with a blob never extends
it). Deleting them
when an apply finished would take bytes from a concurrent apply by the same caller that planned
with the same blob and has not written it yet, and no point in an apply can tell that no other one
still needs them; leaving them also means a retry, or the next apply of the same bytes, uploads
nothing. The server plans once per apply, whatever the directory's size.

Staging (`apps/sim/lib/workspace-source/staging/store.ts`, use cases in
`application/stage-blobs.ts`) is scoped to the workspace and the caller (a person's credentials
share one scope; a workspace API key has its own), capped per scope at `maxStagedBlobs` and
`maxStagedBytes`, and expires a day after a blob was last staged; an
hourly cron (`/api/cron/cleanup-source-staging`) deletes expired rows and objects. Both staging
calls need write access, as the apply does, and draw on their own rate bucket. A manifest entry
never carries bytes: the contract refuses `blobs[].content`.

**One correlation id per apply.** An apply that writes mints an `applyId` and runs its writes
inside `withAuditCorrelation` (`@sim/audit`): every audit entry a child use case records then
carries it as `metadata.correlationId` (a rolled-up entry too, keyed by it), and so does the
apply's own roll-up. The id is in the response, and the CLI prints it.

**Deleting a deployed workflow.** A workflow delete counts the live triggers its deployment serves
(`liveTriggerCounts`, `kinds/deployment/triggers.ts`) as its destructive counts, as an undeploy
does: their webhook URLs and schedules go with the workflow, and a workflow created in its place
gets new ones. An update never moves them: block identity comes from the folder's lock, and
`webhookId`/`triggerPath` are copied from the stored block (`packages/workflow-code/DESIGN.md`); a
block retyped or deleted while live warns `W_APPLY_TRIGGER_REMOVED`.

## Promotion

`sim workspaces source apply --to <workspace>` applies a directory read from one workspace (dev)
to another (prod) without rebinding the directory. The CLI reads the target as a get would
(`GET /source` for the managed kinds, no blob downloads) and composes the submission with
`promotionSubmission` (`src/promote.ts`): the directory's text with every workflow folder whole,
each folder's `.sim/lock.json` and `.sim/base.json` replaced by the target's folder of the same key
(or dropped, so the key is created), and the target's root base. A base entry the directory does
not declare stays in it when the promotion record holds it for the same id (the directory deleted
it since, so the apply refuses it without `--allow-delete` as it would at home); one only the target
ever held (`targetOnly`) leaves it, so the apply keeps it (`W_UNDECLARED`) whether or not it allows
deletes. Deleting those takes `--delete-target-only` beside `--allow-delete` (the CLI refuses it
alone): `--allow-delete` is consent to the directory's own deletes, and must not also reach the
target's prod-only tables, their rows, or skills made there. The CLI names each such delete
`W_PROMOTE_DELETES_TARGET_ONLY`, and `promotionRecord` never records a target-only entry (a held
delete keeps its submitted base entry, which would otherwise read as the directory's delete on
the next promotion). The server sees an ordinary apply against its own base,
so every rule holds unchanged: a resource bound under the key is updated in place (a workflow keeps
its id and block ids through the target's lock), an unbound one of the same name is adopted, a
missing one created, and secrets and credentials bind by name and key to the target's own. The
directory stays bound to the workspace it was read from; the one thing a promotion saves is the
target's promotion record, `.sim/targets/<workspaceId>.json` (`promotionRecord`): the target's
base entries after the apply and, per workflow folder, the target workflow's fingerprint and a
digest of the folder as promoted. The next promotion composes with it: each base entry the record
holds for the same id stands in for the target's live one, so the server's three-way rule compares
with what the last promotion left (a target edit since is kept when the directory left the resource
alone, `E_APPLY_STALE` when it changed it too); a workflow folder whose digest is unchanged is sent
as its base alone (a no-op), and an edited one whole with the recorded fingerprint, so a target edit
since is the folder's 409. Without a record entry (the first promotion, or a resource created in
the target since) the live entry is the base and the target is updated to match the directory, so
deleting the record makes the next promotion overwrite every change made in the target since,
rows its runs wrote included: the stale hint never suggests it. Read alone, the target's live base could
never look changed. Without `--to`, the CLI refuses a
directory read from another workspace (`SOURCE_OTHER_WORKSPACE`); `--workspace <target>` instead
applies it as a copy whose base the server ignores (`W_BASE_OTHER_WORKSPACE`), which only a first
apply to an empty target survives (a second is `E_APPLY_NO_BASE` for everything it created).

A directory's root base is authoritative for the workspace it belongs to: `get` into a directory
holding one refreshes that workspace whatever the profile's default, and refuses a `--workspace`
naming another (`SOURCE_OTHER_WORKSPACE`), as `apply` refuses one; `apply --to` is the one way to
send a directory to another workspace.

## Git and the CLI's files

Everything a get writes is meant to be committed: the base files are what an apply compares with
from any clone, and `.sim/written.json` is what tells a removed blob from one no get downloaded
(`SOURCE_BLOBS_NOT_FETCHED`). The generated `.gitignore` lists only what a command holds while it
runs (`.sim/downloads/`, `.sim/command.lock/`, `.sim-staging-*`), and `.gitattributes` marks
`files/**` and `knowledge/*/docs/**` `-text` after the LF lines, since a commit that rewrote a
blob's line endings would change its hash. In a fresh clone `check` downloads the block catalog
once (the cache lives in the CLI's config directory, not the repository). Every text file is read
with CRLF folded to LF and a byte-order mark dropped, so a Windows checkout reads as unchanged.

One command at a time per directory: `get`, `apply` and `check` hold `.sim/command.lock` (a
folder, created atomically, recording the pid and host). A second command meanwhile exits 10
(`SOURCE_DIR_BUSY`) with nothing read or written; a lock whose process on this host is gone (or
that never recorded an owner within a minute) is taken over. Each file moves into place by a
rename, and the record files last, but a set of renames is not atomic: without the lock, two
commands' files and records could interleave and a later apply would send stale text as an edit.

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
  `packages/workflow-sdk/scripts/generate-embedded-text.ts`; `check:workflow-sdk-embedded-text`
  fails until it is re-run.
- The CLI side is `packages/sim-cli/src/commands/protocol/workspace-source-*.ts`.
  `workspace-source-dir.ts` writes the directory's `tsconfig.json` (`workspaceTsconfig`), the agent guide
  (`AGENTS_GUIDE`) and the local declarations a get types (`localDeclarations`).
- `cookbook/workspace/` in the SDK package is the example directory.

The steps for adding a kind are in `.claude/rules/sim-workflow-code.md`.
