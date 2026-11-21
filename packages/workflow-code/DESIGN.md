# @sim/workflow-code: design

A Sim workflow can be read and written as one TypeScript file (`workflow.ts`, plus function code
under `functions/`). This package holds the pure engines that make that lossless: the canonical
model, canonicalize, print, compile, materialize, equality, the lock and source meta. The server
(`apps/sim/lib/workflows/code/` and the `source-*` use cases in `apps/sim/lib/workflows/application/`)
adds the catalog, resource keys, persistence and the apply gates. `@sim/workflow-sdk` holds the
authoring types; `src/compile/SYNTAX.md` is the surface reference.

```
                         stored graph (DB, authoritative)
                                   │
              canonicalize ◄───────┴───────► materialize (over prev)
                   │                               ▲
                   ▼                               │
         CanonicalWorkflow (CWM) ──── equal? ──── CWM
                   │          executableView       ▲
                 print                          compile
                   ▼                               │
             workflow.ts + functions/* ──edit──► workflow.ts + functions/*
```

## Source holds what executes

Source carries every value the workflow runs with and nothing else. A value is **active** when the
serializer sends it to the executor (`extractBlockParams`, after the load-time migrations) or, for
a block acting as a trigger, deploy reads it into the webhook provider config
(`buildProviderConfig` copies every trigger-mode field except display-only system ids, visible or
not). `catalog/activity.ts` is the one rule; canonicalize, print, materialize and the executable
view all ask it. An opaque catalog condition counts as satisfied unless the catalog expanded it per
operation (`visibleFor`), which is exact.

Everything else is **preserved state**: inactive values, which member of a basic/advanced pair holds
a value and its mode, the fields of the loop or parallel types not in effect, layout, and unknown
`block.data`. Source has no syntax for it. The printer leaves it out, and apply restores it from the
stored workflow (see "Preserved state"). There is no verbose mode.

Two escape hatches carry state that runs but has no SDK syntax:

- `meta.extra`: stored params of a schema-agnostic custom block, the agent's legacy prompt fields,
  a container's stored params other than those `block.data` supersedes (the config inputs the
  editing engine copies into `data`, `SUPERSEDED_CONTAINER_PARAMS`), which never run and are
  preserved state.
- `meta.subflowData`: a loop or parallel's `block.data` subflow keys canonicalize could not read as
  config, which the serializer passes on. Kept apart from `extra` because canvas containers often
  store params under the same names.

## Defaults

An omitted param means the editor default, so a block written with no params is stored exactly as
a canvas-created one and runs the same.

The editor default is what canvas creation writes (`createBlockFromParams` with no inputs, wrapped
by `MaterializeHooks.initBlock`), per subBlock id, first declaration wins
(`catalog/defaults.ts`):

- a visible editable field gets its `value()` thunk's result for a block with no values
  (`valueDefault.constant`, or `valueDefault.initial` for a computed thunk whose creation value is
  stable);
- a hidden field gets its `defaultValue`;
- a read-only field, and a thunk that mints a fresh value per call (`mintsFreshValue`, such as the
  generic webhook's token), have none. A block created from source keeps the value `initBlock`
  minted, as canvas creation does.

Only scalars count as defaults. The printer omits a value equal to the default and prints `null`
for an active field that has a default but no stored value. Compile fills an omitted param with
its default; `null` and `todo()` stay stored-absent. Materialize writes a new block from
`initBlock` and nulls only what the CWM leaves absent.

## The canonical model

`CanonicalWorkflow` (`model.ts`) projects a stored graph with no ids and no layout, keyed by
block key. The DB graph stays authoritative; the CWM is computed on read and written back through
materialize. There is no separate draft type: compile returns a CWM, and ids bind only in
materialize.

- `meta`: the workflow row's `name` and `description` (`WorkflowState` does not carry them).
  A source that changes them renames or redescribes the workflow: the graph diff never sees them,
  the write applies them through the workflow update use case after the graph commit (whose
  fingerprint check they would otherwise move), and a name another workflow in the folder holds
  is `E_NAME_TAKEN` at the header. The fingerprint covers them, so a rename on the server since
  the read is a stale 409 as any other change.
- `blocks[key]`: `name`, `type` (including legacy and `custom_block_<slug>`), `parent`, `enabled`,
  `locked`, `triggerMode`, `advancedMode` (semantic: it changes what serializes),
  `errorPort` (`errorEnabled || has an error edge`), `retry` (raw `BlockRetryConfig`), `params`,
  `modes`, `branches?`, `subflow?`, `extra?`.
- `params[subBlockId]` is `{ kind: 'value', value }` or `{ kind: 'tools', tools }`. Excluded:
  synthetic tool mirrors, server-owned trigger runtime ids (`webhookId`, `triggerPath`,
  `triggerConfig`, `triggerId`; materialize copies them from prev), parked `_removed_` keys and
  `conditions`/`routes` (lifted into `branches`). A stored `null` is absent; `''` is kept.
- The CWM is **encoding-free**: whether a subBlock held native JSON or JSON text is not recorded,
  so equality, hashes, diffs and the fingerprint never see it. Materialize picks the encoding:
  prev's raw encoding, else the catalog `storage`. A switch's or slider's legacy text (`'true'`,
  `'0.7'`, `'1.0'`: what registry defaults once seeded) is an encoding the same way: the CWM holds
  the boolean or number, and an unchanged value keeps prev's text. A switch or slider another
  field's condition reads keeps its text, since visibility compares strictly.
- `Value` is JSON plus `SimNode`s, the internal-id sites lifted to keys:
  `{ $sim: 'var', key }`, `{ $sim: 'resource', kind, key }`, `{ $sim: 'unresolved', kind, id }`
  (an id the resolver could not map, kept verbatim with `W_CANON_UNRESOLVED_ID`),
  `{ $sim: 'csv', items }` (comma-joined ids) and `{ $sim: 'literal', value }` (escapes a stored
  object that has its own `$sim` key, so the encoding stays a bijection). In a `files` value only
  each object's `key` becomes a node. `ResourceKind` is `PortableResourceKind` minus `env-var`
  (`@sim/workflow-types/resources`); env vars stay `{{NAME}}` text.
- Strings are stored text. References stay `<block.path>`, `{{ENV}}` and `<variable.key>` tokens;
  canonicalize only normalizes ref prefixes and rewrites `<variable.<id>>` to `<variable.<key>>`.
- `branches`: `{ kind: 'condition' | 'router', rows }`, each row `{ key, value, titleOverride?,
  titleMissing?, extra? }`. `rows: null` means the subBlock was never persisted; its source form is
  an empty branch object and the implicit ports (`if`/`else`, `route0`) stay addressable. A
  persisted list is never empty. Branch keys persist on the stored rows as the optional row `key`.
- `subflow`: `LoopSpec` or `ParallelSpec`, optional fields absent exactly when storage omits them.
  `LoopSpec.iterations` is the count that runs: `block.data.count`, or 5 when absent
  (`convertLoopBlockToLoop`).
- `edges`: `(from, port, to)` tuples sorted by `(from, portKey, to)` with `compareStrings`. Ports:
  `out`, `error`, `branch:<key>`, `subflowStart`, `subflowEnd`, `raw:<handle>`. `portKey` and
  `parsePortKey` (`anchors.ts`) are the only string forms. Edge ids are not in the CWM or the lock.
- `variables[key]`: `{ key, name, type, value }`.
- `annotations`: `comments` (by `AnchorKey`). Annotations never take part in equality, hashing,
  diffing or the fingerprint. Which stored params never run is not recorded: print, compile and
  apply all ask `executableInactiveParams`.

`canonicalEquals` ignores annotations, key order and edge order. `canonicalHash` is
`sha256Hex(stableStringify(cwm minus annotations))` (`hash.ts`: `stableStringify` sorts keys with
`compareStrings` and throws on non-JSON; `sha256Hex` is `@noble/hashes`). `diffCanonical(base,
target, renames?)` is a key-based diff; without `renames` a rename is a remove plus an add.

Anchors (`Anchor`, encoded by `encodeAnchor` to a branded `AnchorKey`) are `header`, `wiring`,
`footer`, `block`, `param` (the printed param name: the `canonicalParamId` for a pair), `edges`
(block and port) and `var`.

## The executable view

`executableView(cwm, catalog)` (`equivalence/executable.ts`) is the CWM minus preserved state:

- inactive params (`executableInactiveParams`, with the CWM's effective modes as overrides);
- the pair member and mode: a pair projects to one param under its `canonicalParamId`, as the
  serializer sends it;
- the fields of loop or parallel types not in effect, and spellings the runtime reads alike
  (`count || 5`, `collection || ''`, clamped `batchSize`);
- unknown `block.data`, except a container's unreadable subflow keys, which the serializer passes on.

It takes the catalog because the pair and activity rules need it. Source fidelity (P0, P1) is
equality of executable views; stored bytes are compared separately (O1, P6).

## Identity

**Block key**: `normalizeWorkflowBlockName(name)` (lowercased, whitespace and dots stripped).
References resolve only by this form, so it is unique per workflow. When two stored names
normalize alike, the block the resolver binds keeps the key and the others become `key~n` (smallest
free `n ≥ 2`) with `E_CANON_LEGACY_NAME_COLLISION`. A reserved name (`loop`, `parallel`,
`variable`) gets `W_CANON_RESERVED_NAME`. Source carries such a legacy key through `meta.key`, which
compile accepts only for a key in `CompileInput.knownKeys` (the stored workflow's keys) and only in
those two shapes (`E_KEY_OVERRIDE` otherwise), so source round-trips a legacy key but never
introduces one.

**Ident**: the `const` name a block prints as. Derived camelCase from the name on first print
(`assignIdentifiers`), then persisted, so a canvas rename changes one line. Never one of
`SDK_RESERVED_IDENTIFIERS` (JS reserved words plus `SDK_CORE_EXPORTS`).

**Lock** (`.sim/lock.json`, `lock.ts`): environment-independent identity, kept in the repo.

```
WorkflowLockV1 { version: 1, blocks: { [key]: WorkflowLockBlock }, variables: { [key]: id } }
WorkflowLockBlock = LockIdentityBlock { id, parent, branches?, items? }
                  + { ident, order, layout?, codeFile? }
```

`LockIdentity` (ids, parents, branch row ids, per-subBlock item ids as `Array<{ name, id }>`) is
what canonicalize derives, materialize returns and the fingerprint hashes. `order` is a print-order
tie-break and need not be unique, so a lock merged from two branches stays valid. `parseWorkflowLock`
is strict: unknown fields are errors except `x-` keys on the lock, its blocks and layout, which are
preserved; keys must be normalized; idents unique and non-reserved; ids unique per scope; parents
must exist without cycles; `codeFile` a normalized relative POSIX path. It reports every problem at
once with an RFC 6901 `path` (`E_LOCK_*`). Adding an optional field does not bump `version`;
validators learn a field before writers emit it, and data waits under `x-` until then.

**Source base** (`.sim/base.json`, `SourceBase`): one environment's freshness facts:
`{ workflowId, workspaceId, fingerprint, catalogHash }`. Get returns it beside the lock and apply
requires it (wire `base`). A base from another workflow is refused (`E_APPLY_WORKFLOW_MISMATCH`, by
the CLI and the server); one from another workspace makes the lock stale.

**Source meta** (`workflow_source_meta`, `source-meta.ts`): the server-side copy of the hints plus
comments, `WorkflowSourceMetaV1 { version: 1, idents, order, comments }`, keyed by **block id** so a
canvas rename never orphans an entry (comment anchors carry block and variable ids). It lets idents,
order and comments survive canvas-only edits and prints with no repo lock. It lives in a side table
(`workflow_id` pk, cascade delete), so no read of the hot workflow row loads it; source get/apply,
duplicate, fork/promote copy and the prune on block or variable delete read it, and an empty value
deletes the row. `parseSourceMeta` mirrors `parseWorkflowLock` (`E_SOURCE_META_*`).

**Hints** (`SourceHints`): per block key, `{ ident?, order?, codeFile? }`. Print reads them,
compile reports them as written. `hintsFromSourceMeta` and `buildLockFromState`
(`apps/sim/lib/workflows/code/source-lock.ts`) convert between id-keyed source meta and the
key-keyed lock; `mergeSourceMetaFromLock` stores a write's hints back by id.

**Identity resolution** (`materialize/identity.ts`) binds each compiled block, in rule order:

1. `lock-key`: the lock entry under the same key, when its id is in prev;
2. `lock-ident`: a lock entry whose key the file dropped but whose ident it still uses
   (`MaterializeOptions.compiledIdents`), so editing only the display string keeps the id. A key
   whose ident now belongs to another lock entry binds that entry too, even when both keys
   survive: two blocks that swap display names (equivalently, two consts that swap names) are two
   renames, and each block keeps the id, webhook and schedules of its const. The plan lists both;
   `lockIdentRenames`, the compile-side mirror, covers only dropped keys and so reads such a
   swap by key;
3. `db-name`: the prev block with the same key (the lockless and stale-lock path);
4. `inferred`: exactly one unmatched prev block and one unmatched compiled block with the same
   type and parent and agreeing edge neighbourhoods, so renaming the variable and the display
   name together keeps the id; failing that, a prev block the lock binds (the source dropped its
   key and its ident) pairs with a new block of its type and parent only when exactly one such
   pair shows a strong identity signal: equal settings (references to the old key read as the
   new), most bound neighbours shared, or every block that referenced the old key now referencing
   the new one. A trigger (webhook paths, schedules) pairs only on equal settings, under either
   rule (`W_MAT_INFERRED_RENAME`; to get a new block instead, delete the old one in one apply and
   add the new one in the next). A delete and an add with no signal stay a delete, refused as
   `E_APPLY_BLOCK_DELETE` (naming the look-alike new blocks and how to keep the ids) unless the
   caller passes `allowDelete`;
5. otherwise created: the lock's id when unclaimed, else minted (`idSource`).

A match across types is a delete plus a create (`W_MAT_RETYPE_RECREATED`), except a catalog
`sunset.replacedBy` pair, which keeps the id. `lockFreshness` (`fresh`/`stale`/`none`) decides whether
a stale lock entry whose id left prev is re-created with `W_MAT_DELETED_SINCE_PULL`. A lock id
another workflow already stores is dropped and minted fresh (`W_MAT_LOCK_ID_CLAIMED`). Variables
keep their ids by key: the lock's, then prev's, else new.

**Resource keys**: `table('leads')`, `credential('support-slack')` name workspace resources by a
persisted key (`workspace_resource_key`, `apps/sim/lib/workspaces/resource-keys.ts`). A key is
allocated from the resource's name the first time it is needed and never changes; a rename keeps it,
and a delete leaves it on the dead id so it stops resolving instead of moving. Only resources live
in the workspace resolve. Canonicalize keeps an unmapped id as `unresolved`; materialize refuses an
unknown key (`E_MAT_UNKNOWN_RESOURCE`).

## Fingerprint

`sourceFingerprint(cwm, identity)` is `sf1:` + `sha256Hex(stableStringify({ cwm minus annotations,
identity }))`. It covers variables and locked flags and excludes layout, so a canvas drag never
makes a source stale. `canonicalHash` covers the CWM alone. Get returns the fingerprint in
`base.fingerprint`; apply recomputes it from the stored draft and answers 409 on a mismatch.

## The catalog

The source catalog is the per-workspace authoring catalog codegen, print and compile read
(`apps/sim/lib/workflows/code/catalog/`). `projectBlockCatalog` projects the live registry
(`CatalogBlock`, `CatalogTrigger`, frozen builder names from `apps/sim/blocks/sdk-names/`);
`buildSourceCatalog` narrows it to the caller's gate (visibility, allowlist, the workspace's custom
blocks) plus every type the workflow already stores, marking types that may stay but not be added
`addable: false`. Builds are cached by content key in an `lru-cache`.

Notable fields:

- `CatalogBlock.graph` (`canBeTarget`, `errorPort`, `container`, `annotationOnly`, the branches
  subBlock), `dynamicOutputs?: { source, param }`, `singleInstance`, `paramAliases` (frozen
  `sdk-names` aliases, `oauthCredential` → `credential`), `addable?: false`, legacy ids.
- `CatalogSubBlock`: `surface` (separates the action and trigger copies of one id), `condition`,
  `visibleFor`/`visibleWhen`/`visibleForModel` (data the projection precomputed for function
  conditions), `valueDefault`, `defaultValue`, `password`, `storage`, `columns`, `step`, `integer`,
  `valueShape` (the shape the value takes in an agent tool entry, `getSubBlockValueShape`, which
  canonicalize decodes a stored tool param by; absent is `string`).
- `valueKind`: `string | number | boolean | array | object | json | code | branches | tools |
  resource | picked | upload | none`. `resource`, `picked` and `upload` are the selector kinds;
  `resourceKind` is set iff `valueKind` is `resource`. A JSON `code` member has kind `json`.
- `options`: a static list, `{ dynamic: true }` (fetched through a selector) or `{ opaque: true }`
  (an unevaluated function). **Opaque** means only this "could not evaluate" marker.
- `builders`: keyed by dotted SDK path (`slack.sendMessage`, `trigger.gmail.poller`); `fixed`
  never repeats `operation`. A type with no builder prints through `block(type, name, params, meta?)`
  (`GENERIC_BUILDER`).

**Compact and view accessors.** The served form is the core shard (`BlockCatalog`), a compact
encoding whose entry types are supersets of the expanded ones, so an expanded catalog (every test
fixture) is a valid shard. `compactBlockCatalog` (`catalog/compact.ts`) dedupes trigger-mode
subBlock runs into `{ trigger, start, count }`, repeated subBlocks into `subBlocks` (`{ shared }`),
repeated condition lists into `lists`, repeated outputs into `sharedOutputs`/`sharedProperties`,
drops labels equal to their id, and drops a block's other option labels (except the `operation`
dropdown's), which nothing reads; an absent label reads as its id. Titles, output descriptions,
defaults and option ids stay because codegen and the printer read them. `expandBlockCatalog` and
the accessors in `catalog/view.ts` (`catalogBlock`, `catalogBlockTypes`, `catalogTrigger`,
`catalogBuilder`, `catalogBuilderPaths`, `catalogBuildersOfType`) decode lazily, memoized per catalog object. No consumer indexes `catalog.blocks`,
`catalog.triggers` or `catalog.builders` directly. The hash is SHA-256 over `stableStringify` of
the core shard, deterministic because tables fill in key order; it is the ETag and
`base.catalogHash`.

Shared semantics live in one place each: `catalog/surface.ts` (which declarations a block uses, and
param aliases), `catalog/conditions.ts` (visibility; `'undecided'` is each caller's policy),
`forms/` (the response `body` form, the condition `else: true` and the loop and parallel config
forms, each printed and compiled by one module; the executable view also reads the container
forms), `structured/` (one codec per structured subBlock kind whose value stays a param, with its
canonicalize, compile, print and materialize hooks, held in a record total over those kinds; `tools`
and `branches` are lifted into their own model shapes and have their own stage modules),
`catalog/activity.ts` (active vs inactive) and `catalog/defaults.ts`.

## Canonicalize

`canonicalize(state, { catalog, meta, lock?, resources? })` → `{ workflow, identity, layout,
diagnostics }`. Pure and total: problems become diagnostics (`E_CANON_*`, `W_CANON_*`), it never
throws. Migrations stay server-side; the input is an already-migrated graph. The lock supplies only
branch keys by row id; it never changes block keys. It assigns block keys, decodes structured
values (tools, table rows, inputFormat, tag filters), lifts ids to `SimNode`s, records each pair's
effective mode as the serializer resolves it (explicit override, then `advancedMode`, then which
member holds a value; only on the surfaces the block serializes), lifts branches and subflow
config. An MCP tool's `serverId` lifts to an `mcp-server` key, and
its `toolId` is dropped when the binding derives it (`createMcpToolId`); materialize derives it
again, so a re-encoded MCP tool that lacked one gains the picker's. The server canonicalizes a stored draft once per request
(`stored-canonical.ts`).

## Print

`printWorkflow({ workflow, catalog, hints?, options })` → `{ files, hints, diagnostics }`.
Deterministic: the same input prints byte-identical text, a one-param change touches one line, and
the output is a Biome fixed point (`print/doc.ts` reproduces Prettier's layout algorithm). Every
print compiles with zero errors.

- Blocks are declared in topological order per scope; ties sort by trigger first, then hint
  `order`, then key. A ref that would point forward (a ref cycle) prints as literal text
  (`W_FORWARD_REF_LITERALIZED`).
- Idents come from hints, else `assignIdentifiers`.
- Only active values print, and none equal to its default. A pair prints under its
  `canonicalParamId` (or its alias) and the value kind alone picks the member (see SYNTAX.md "Pair
  mode"). A builder prints only blocks on its own surface; anything else prints through `block()`.
- References inside strings become interpolations when they resolve in lexical scope; anything else
  stays literal text that compiles back to the same bytes (`print/refs.ts`).
- Strings escape bidi and zero-width characters (`‮`).
- `functionCode: 'files'` writes function code to `functions/` (see "Code files"); `'inline'` uses
  `js` templates.
- An agent tool prints in the first form whose compile reproduces it exactly: `mcp('k').tool()`
  and `childWorkflow('k').asTool()` (`agent-tools.ts` pairs each reader with the builder compile
  calls), `customTool('k')`, the block builder's `ns.tool.method()`, else `raw(tool)`.

## Compile

`compileWorkflow({ entry, files, catalog, sdkMajor, limits?, knownKeys?, stored?, storedUnread?,
storedUnreadEdges? })` → `{ workflow, diagnostics, spans, hints, sdkMajor, envReferences, edges }`. It parses with Babel and interprets the AST statically; it
never executes the file. `workflow` is `null` iff any diagnostic is an error. It accepts exactly
what the printer emits plus the conveniences SYNTAX.md lists, checks names, scope, wiring and
catalog fields, fills defaults, resolves `stored()` from `CompileInput.stored`, and returns `spans`
(anchor → source span) so later server findings map back to lines. Diagnostics carry `span` and a
code `frame`; Babel's 0-based columns become 1-based, and lines split the way Babel does.

Compile also refuses or flags source the runtime would silently mishandle:

- wiring that closes a cycle among enabled blocks, a self-loop included, is `E_EDGE_CYCLE`: the
  executor makes a block wait on every incoming edge, so no block on a cycle runs (a disabled block
  is not in the run graph and breaks one); repetition is `loop()`/`parallel()`. A cycle made only
  of edges the stored workflow holds is `W_EDGE_CYCLE`, so stored state keeps round-tripping
  (`storedUnread`, the CLI's offline check, which has the lock but not the stored workflow, takes
  every edge between two blocks its lock binds, by key or by ident for a block renamed in source,
  as one it may hold, or with `storedUnreadEdges`, the edges the get printed by lock key, only
  those; the same goes for `W_ERROR_PORT_STORED`);
- a reference into an agent whose `responseFormat` declares its fields, or into a Start, API or
  Input trigger (whose `inputFormat` declares its inputs), names a declared field or a static
  output (`W_UNKNOWN_OUTPUT_PATH` otherwise; a warning, since a caller may pass an undeclared
  input the unified Start passes through); a format with references inside is unread;
- a dropdown value outside its static options is `W_UNKNOWN_OPTION`, a `model` the catalog does
  not list `W_UNKNOWN_MODEL` (free text stays valid), and an unknown `operation`
  `E_UNKNOWN_OPERATION` unless the stored block already holds it. An apply refuses
  `W_UNKNOWN_OPTION` (`E_APPLY_INVALID_SUBBLOCK_FIELD`, `diagnostics/refusals.ts`) only on a field
  the edit sets, the fields the server's value gate judges; the CLI's offline check, which holds no
  stored values, counts every field of a changed block. Options a registry function derives from
  deployment settings are marked `optionsVary` in the catalog: the offline check keeps a value
  outside them a warning, since its cached catalog may have been built under other settings, and
  leaves the verdict to the server, whose catalog and gate run in one process;
- a new block of a legacy or deprecated type is `W_LEGACY_BLOCK_TYPE`, naming its replacement.

## Materialize

`materialize(cwm, lock, { catalog, hooks, prev?, resources?, compiledIdents?, lockFreshness })` →
`{ state, identity, entries, needsLayout, diagnostics }`. It resolves identity,
then writes the stored graph so that a no-op is byte-identical (O1):

- a param canonical-equal to prev's keeps prev's raw value;
- an edge whose `(from, port, to)` matches a prev edge reuses that whole edge object, id and
  handles included;
- a subflow config canonical-equal to prev's is written back verbatim to `block.data` and the
  loops/parallels map;
- server-owned fields (trigger runtime ids) come from prev by id;
- stored `outputs` are rewritten only when `computeOutputs` differs between prev and the edited
  block, so stale outputs survive an unrelated edit;
- new blocks start from `hooks.initBlock`; new blocks with no prev or lock position are listed in
  `needsLayout` for targeted autolayout.

`MaterializeHooks` (`initBlock`, `computeOutputs`, `newId`) are implemented server-side
(`materialize-hooks.ts`).

## Preserved state

`materialize/preserve.ts` restores, for each matched block of the same type, before writing:

- when a pair's executable value is unchanged, prev's members and mode; when a plain id changed and
  prev showed the basic selector member, prev's member (whether a selector or typed text produced
  the id is canvas state);
- every param inactive under the target's values, from prev (absent included, so defaults compile
  filled into fields that never run are dropped);
- the fields of the loop or parallel types not in effect, and prev's whole config when it runs the
  same;
- unknown `block.data` source does not carry;
- a container's subBlocks `block.data` supersedes (`iterations`, `loopType`, …).

Canonicalize's output already holds all of this, so restoring onto it changes nothing.

## JSON fields and typed refs

A JSON code field (a `code` subBlock holding JSON text: an agent's `responseFormat`, table row
`data`, a response body) may be written as an object literal (`json-fields.ts`). The executor
splices a reference's value into such text raw for a string and as JSON otherwise, so a bare
reference in a literal is stored by its output type: quoted (`"<a.b>"`) when the catalog or the
workflow types it `string`, bare (`<a.b>`) otherwise, and bare with `W_JSON_REF_UNTYPED` when
nothing types it. A string in the literal (a template or plain string) is always a JSON string. The
printer writes stored text back as a literal only when serializing that literal reproduces the text
byte for byte; print and compile decide each token's form through the same `refValueKind`. In a
pair, a list or object literal never lands in the JSON code member when the other member takes it
as written (`table_v2`'s filter builder).

## Secrets

A secret is never printed. `secrets.ts` holds the one predicate print and compile share
(`holdsSecret`): literal text in a `password` subBlock, or in any other field a high-confidence
credential (`holdsDetectedSecret`): a known token format (`sk-…`, `ghp_…`, `xoxb-…`, `AKIA…`, a
JWT, a private key, `Bearer <token>`), a credential header row (`Authorization`, `X-Api-Key`), a
credential-named property, code assignment or URL query parameter (`api_key`, `client_secret`,
`password`, `token`) holding a non-placeholder literal, or a URL's userinfo password. Reference and
`{{ENV}}` tokens never count, so `Bearer {{TOKEN}}` is not a secret; placeholders (`YOUR_API_KEY`,
`********`) are not either. Every scan is linear in the text.

Such a param (block params, agent tool params and MCP tool arguments alike) prints as `stored()`,
meaning "keep the stored value", with `W_LITERAL_SECRET`; compile warns the same way where source
writes one literally. A custom tool snapshot's code has no `stored()` form, so a credential there
only warns. Compile resolves `stored()` to the value `CompileInput.stored` (the stored workflow,
canonicalized under the submitted lock) holds for the same block key, type and param, a pair's
members and mode included, so a get followed by an unchanged apply keeps the value. A new block,
another type or an empty field is `E_STORED_VALUE_MISSING`; `stored()` nested inside a value is
`E_UNSUPPORTED_SYNTAX`. Without `stored` (a create), `stored()` is refused.

## Code files

In `files` mode the printer writes a function block's code to `<codeDir>/<kebab-case ident>.<ext>` (the hinted path when it still fits) and the
source references it as `codeFile('./functions/x.js')`; the hint records the path and the lock
keeps it as `codeFile`. Python and shell are verbatim. JavaScript rewrites tokens in code position:
`<a.b>` becomes `$ref.a.b` and `{{X}}` becomes `$env.X` (`code-files/to-file.ts`); reading back
rewrites every member chain rooted at `$ref`/`$env` (`from-file.ts`). The printer checks the
bijection first (`code-files/bijection.ts`) and falls back to an inline `js` template with
`W_CODE_FILE_INLINED` when reading back would differ. Compile requires the path to be relative,
inside the directory, and matching the block language (`E_CODE_FILE_PATH`), and the file to be sent
(`E_CODE_FILE_MISSING`). The CLI resolves files with `realpath` and refuses symbolic links.

## Diagnostics

`diagnostics/codes.ts` lists every code. The prefix fixes severity (`E_` error, `W_` warning, `I_`
info) and `Diagnostic` is a union over codes, so a mismatched severity does not type-check. The
next segment names the owning stage: none for compile and print (one shared vocabulary), then
`LOCK_`, `SOURCE_META_`, `CANON_`, `MAT_`, `APPLY_`. Apply gate codes mirror the editing engine's
`SkippedItemType` as `E_APPLY_<UPPER_SNAKE>`. Add a code rather than reuse one with a different
meaning; codes freeze at release.

A diagnostic carries `span: SourceSpan` (file, 1-based line and column in UTF-16 units, end, UTF-16
offsets), `frame`, optional `hint` and `related`. Compile returns `LocatedDiagnostic`, which
always has `span` and has `frame` unless the finding is about a literal secret (`framesSource`); lock and source meta diagnostics carry an RFC 6901 `path` instead.
`codeFrame` shows two context lines, marks every spanned line with `>`, puts the caret under the
start line, and clamps bad input (NaN to 1, ±Infinity to a bound).

## Apply

`applyWorkflowSource` and `createWorkflowFromSource` (`apps/sim/lib/workflows/application/`) share
one pipeline (`source-pipeline/`): `planSource` loads the target and evaluates, then a dry run
previews the plan (`previewSource`) and a write commits it (`commitSource`). A workspace apply
plans and commits each workflow through the same steps (`workflowSourceUpdate`,
`workflowSourceCreate`), the commit refusing a plan made for another workflow or principal. Create uses an empty graph as the stored draft, so every block is new and no
fingerprint is checked. Both are gated on the `workflow-code` flag (see Rollout) and change only the draft;
deploy is separate.

```
 request ─► base.workflowId matches? ─► fingerprint fresh? (409) ─► evaluate ─► commit
                 (400 mismatch)                                      │            │
                                                             refuse: errors   one replace under
                                                             with lines       the row lock
```

**Evaluate** (`source-pipeline/evaluate/`, one file per phase, writes nothing):

1. parse the lock; canonicalize the stored draft under it (what `stored()` reads and the diff
   compares against);
2. compile against the workflow's source catalog with `knownKeys` and `stored`; on errors, add
   `W_APPLY_CATALOG_MOVED` when `base.catalogHash` differs from the current catalog;
3. resolve or allocate resource keys the source names; set `lockFreshness`;
4. materialize over the stored graph; drop lock ids another workflow holds and re-materialize; on
   `E_MAT_UNKNOWN_RESOURCE`, load the keys of the missing kinds (`ResourceKeyResolver.keysOf`) and
   re-materialize so the finding lists them with a did-you-mean;
5. gates, each refusal an error so nothing is written:
   - deleted blocks: an apply that removes a block the source no longer declares is
     `E_APPLY_BLOCK_DELETE` (naming them) unless the caller passes `allowDelete` (`--allow-delete`,
     which a workspace apply passes through), as a workspace apply refuses a resource delete;
   - a changed name another workflow in the folder holds is `E_NAME_TAKEN` (a changed name or
     description is otherwise written, as a rename);
   - schedules (`code/apply/schedules.ts`): an added or changed enabled schedule whose timing deploy
     would refuse (`validateScheduleBlock`: a malformed cron, an unknown timezone, an out-of-range
     interval) is `E_APPLY_INVALID_SCHEDULE`; a draft still missing a field is left to deploy;
   - locked blocks (`code/apply/locked.ts`): any change to a locked block or a child of a locked
     container is `E_APPLY_LOCKED_BLOCK`, admins included;
   - the editing engine's per-user gates on added and changed blocks (`code/apply/gates.ts`):
     `BLOCK_GATES` (`editing/gates.ts`) is the one list the engine and source both run, by subject
     (block placement, retry policy, field value, tool entry), so a gate added there applies to
     both: the engine withholds the refused subject, source refuses the apply. Block types
     (registry, deployment, allowlist, sunset), duplicate triggers and single-instance blocks,
     retry eligibility, model and operation access, tool entries; then, through the engine's own
     functions, credentials the user cannot reach, the copilot tool-binding contract, enablement
     under a disabled container, and the sandbox plan. A hosted key that does not apply is dropped
     with `W_APPLY_HOSTED_KEY_DROPPED`;
   - `addable: false` types added or retyped (`E_APPLY_TYPE_NOT_ADDABLE`);
   - live effects (`code/apply/live-triggers.ts`): deleting or retyping a block with a live
     webhook, schedule, chat output or MCP tool warns `W_APPLY_TRIGGER_REMOVED`;
6. value normalization (`W_APPLY_VALUE_NORMALIZED`), MCP tool schema snapshots, targeted layout,
   then workflow lint mapped to source lines (`E_APPLY_LINT`, `W_APPLY_LINT`).

Every finding is located in the submitted files through `spans`. The result is a `SourcePlan`, or
the refusals. A dry run returns the refusals with a 200 instead of throwing.

**Commit** (`source-commit.ts`): one `replaceWorkflowNormalizedState` under the workflow row lock.
Inside the lock it re-checks the workflow lock (423), re-checks the fingerprint (409), keeps current
canvas positions for existing blocks (a drag during the apply survives), asserts locked blocks are
unchanged, and writes source meta in the same transaction. A graph no-op that changes only idents,
order or comments stores just source meta under the same checks. Create inserts the row, graph,
variables and source meta in one transaction.

**Response**: the files re-printed from what is (or would be) stored, so normalized values show in
the source, plus `lock`, `base`, `fingerprint`, `diff`, `diagnostics` (warnings; on a dry run every
finding), `notes`, `mintedIds` and `needsRedeployment`. Analytics and audit are recorded by the use
case, audit only for a committed write.

**Read** (`readWorkflowSource`): canonicalize, print with hints from source meta, assemble the lock
with `buildLockFromState`, and return files, lock, base, catalog hash and diagnostics.

## Limits

`SOURCE_LIMITS` (`limits.ts`) is the one set of limits for get, compile and apply, so a get's output
can always be applied back unchanged:

- 2,000 blocks (the v2 graph cap, `MAX_WORKFLOW_GRAPH_BLOCKS`);
- 10,000 edges (the v2 graph cap, `MAX_WORKFLOW_GRAPH_EDGES`);
- 2,000 variables, so a lock holds at most that many variable entries;
- 2,001 files: `workflow.ts` plus one code file per block, so files mode never overflows into inline
  code;
- 4,000,000 UTF-8 bytes across every file together, the entry included. No cap applies to a single
  file: function code moves between the entry (inline mode, which the Code tab reads) and code
  files, and a per-file cap would refuse one printing of a workflow and accept the other;
- nesting depth 200: the entry's brackets (checked before Babel parses) and syntax tree, and each
  JavaScript code file's brackets. A 200-block workflow nests under 20 levels.

Compile (`DEFAULT_LIMITS` in `compile/parse.ts`) enforces them with `E_LIMIT_EXCEEDED`, plus one
`codeFile()` reference per block. Syntax nodes need no cap: every node but an empty template element
spans at least one byte, so the byte cap bounds them. Apply answers a source compile refused for a
limit with 413 `PAYLOAD_TOO_LARGE` (`details.code` `SOURCE_REJECTED` with the diagnostics); any other
refusal is 400. The routes cap the body at `SOURCE_REQUEST_MAX_BYTES` (every file at its limit,
doubled for JSON escaping, plus room for the lock). A get checks the block count before printing and
the printed files after (`sourceLimitExcesses`, `sourceDepthOverflow`), and answers 413 naming each
measured size or the file nested too deeply. The CLI exits 7 on a 413 (and on a dry run refused for
a limit), 5 on a 409 and 6 on a 423.

## Proof

The round-trip harness (`apps/sim/lib/workflows/code/corpus/roundtrip.corpus.test.ts`) runs over the
generated registry corpus (every block type and trigger mode), the landing templates, the
`@sim/testing` states, redacted production states from `ROUNDTRIP_CORPUS_EXTRA_DIR`, and fast-check
workflows, against the real catalog. Default mode samples per type; `ROUNDTRIP_CORPUS_FULL=1` runs
everything. Every property must hold for every case.

| | Property |
|---|---|
| P0 | `compile(print(c))` has the executable view of `c` |
| P1 | `canonicalize(materialize(compile(print(c)), prev))` has the executable view of `c` |
| P2 | serializer parity after a full source round trip |
| P3 | `print(compile(print(c)))` is byte-identical to `print(c)` |
| P4 | printed code compiles with zero errors |
| P5 | files mode compiles to the same workflow as inline mode |
| P6 | `materialize(compile(print(c)), prev x)` deep-equals `x`: a no-op apply changes nothing |
| P7 | `diffCanonical(c, materialize(compile(print(c)), prev x).workflow)` is a no-op: an unchanged directory applies as `noop: true` |
| O1 | `materialize(canonicalize(x), prev x)` deep-equals `x` |
| O2 | lockless execution parity: the serialized workflow, compared through the loops/parallels maps the executor runs |
| O3 | `canonicalize(materialize(c))` equals `c` |

Beside it:

- **Inactive** (`inactive.corpus.test.ts`): sentinel substitution proves no param the executable
  view (`executableInactiveParams`) treats as inactive reaches the serializer or deploy.
- **Outputs** (`outputs.corpus.test.ts`): with stored outputs seeded stale, editing one param that
  does not drive outputs leaves the block equal but for that value.
- **Secrets** (`secrets.corpus.test.ts`): a unique secret in every password field never appears in
  either print mode, and compiling against the stored workflow keeps it wherever it runs.
- **Default parity** (`default-parity.test.ts`): for every registry type and trigger mode,
  `block(type, name, {})` materializes exactly as `initBlock` creates it, minted values and
  placeholder branch rows aside.
- **Goldens** (`goldens.test.ts`): each case prints to its golden in `print/__golden__/` against the
  live registry catalog, compiles back to the same executable view, reprints byte-identical, and
  type-checks with `core.d.ts` plus the generated types. `check:workflow-code-golden` keeps them in
  step.
- **SDK examples** (`sdk-examples.test.ts`): the five `@sim/workflow-sdk` examples compile against
  the real catalog with no diagnostics.

## Rollout

Every surface (the v2 source routes and their MCP operations, the CLI `workflows source` and
`workspaces source` commands, the Code tab, and the Mothership source commands) gates on one
runtime flag, `workflow-code` (`apps/sim/lib/workflows/code/feature-flag.ts`). Each use case checks
it against the workspace it runs in: that workspace's organization, the workspace itself, or the
acting user. A refused call answers `403`, and a chat without the flag is not granted the
`workflow-code` entitlement, so the worker hides the source commands from it.

Turning it on:

- **Hosted (AppConfig).** Edit the `workflow-code` entry of the `feature-flags` profile and deploy
  it like any other flag change. `orgIds`, `workspaceIds` and `userIds` allowlist one tenant at a
  time; `enabled: true` turns it on for everyone. No code change or redeploy of the app.
- **Self-hosted, or AppConfig off.** Set `WORKFLOW_CODE=true` in the app's environment: it turns
  the feature on for the whole deployment, with no per-organization scoping.

Stages, each held until the previous one is quiet (no unexpected `403`s, refusals or apply
failures in `workflow_source_applied`, `workflow_source_dry_run` and `workspace_source_applied`):

1. **Internal.** Our own organization by `orgIds`; dogfood the CLI, MCP and chat paths.
2. **Design partners.** Add each partner's organization to `orgIds` as it opts in.
3. **GA.** `enabled: true`. Once it has held, delete the flag, its `WORKFLOW_CODE` fallback, the
   entitlement and every call site.

## Known limitations

- A 409 is whole-workflow: any concurrent change, canvas included, makes the source stale. There is
  no three-way merge; get again and reapply the edit.
- Function code is one verbatim file per block: no imports, no shared modules, and `$ref`/`$env`
  are untyped globals in JavaScript. Source has no loops or helpers that generate blocks; the
  compiler accepts only the printed grammar.
- Nothing runs locally. Checks happen on apply (or `--dry-run`); `tsc -p .` checks types only.
- A comment inside an expression is hoisted to its enclosing anchor (`W_COMMENT_MOVED`).
- Chat in the product does not write through source yet.

## Package wiring

- `tsconfig.json` sets `"types": []`, so no Node globals type-check here.
- `check:boundaries` keeps `src/` (minus tests) free of Node built-ins (even type-only imports),
  dynamic `import()`, `require`, `import.meta`, `.constructor` reads, and value references to
  `eval`, `Function`, `globalThis`, `window`, `self`, `global` and `Reflect`.
- `@xyflow/react` is a devDependency only so `@sim/workflow-types`' `Edge` import type-checks.
- Each engine is a plain function exported from its module, with its input, options and result
  types beside it; `src/index.ts` is the package's only barrel.
