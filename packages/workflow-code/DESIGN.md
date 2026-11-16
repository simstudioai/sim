# @sim/workflow-code: contract decisions

Wave 1 wrote the types every engine builds against. The reconciled build spec wins where it
speaks; this file records the choices it left open. Change a contract type only with the
agreement of every lane that consumes it.

**The Amendments section at the end supersedes any numbered item it names.**

## Layout

| Module | Owner | State |
|---|---|---|
| `src/model.ts` | Wave 1 | types |
| `src/lock.ts` | Wave 1 | types + `parseWorkflowLock` (real) |
| `src/catalog/types.ts` | Wave 1 | types |
| `src/diagnostics/codes.ts` | Wave 1 | types |
| `src/diagnostics/frame.ts` | Wave 1 | types + `codeFrame` (real) |
| `src/anchors.ts` | Wave 1 | `portKey`, `parsePortKey`, `encodeAnchor`, `decodeAnchor` (real) |
| `src/hash.ts` | Wave 1 | `stableStringify`, `sha256Hex` (real) |
| `src/sdk.ts` | Wave 1 | `GENERIC_BUILDER`, `SDK_CORE_EXPORTS`, `SDK_RESERVED_IDENTIFIERS` |
| `src/api.ts` | Wave 1 | engine signatures, type-only |
| `src/catalog/canonical-index.ts`, `src/canonicalize/*` | 2B | |
| `src/print/*` | 2C | |
| `src/compile/*`, `src/code-files/*` | 2D | |
| `src/proof/*` | 2G | |
| `src/materialize/*`, `src/equivalence.ts` | Wave 3 | |

Each engine implements its `api.ts` type, e.g.
`export const compileWorkflow: CompileWorkflowFn = (input) => { ... }`, and adds its runtime
export to `src/index.ts`. `api.ts` stays type-only, so an unimplemented engine fails to import
instead of failing at run time.

## Model

1. **No separate draft type.** The CWM has no ids, so it is already name-keyed. `compileWorkflow`
   returns a `CanonicalWorkflow`; ids bind only in materialize. s3's `CanonicalWorkflowDraft`
   maps onto it as follows: `meta`, `variables`, `blocks[].params`, `branches`, `edges` and
   `annotations` all exist. `options.enabled/errorEnabled/retry/locked` map to `enabled`,
   `errorPort`, `retry` and `locked`. `unknown` maps to `opaque`.
2. **`meta` is in the CWM** (`name`, `description`). The workflow row holds them, not
   `WorkflowState`, so canonicalize takes them as input. `diffCanonical` reports changes. Wave 3
   decides whether apply writes them.
3. **`annotations` is in the CWM but never semantic.** `inactive` (build-spec decision 2) and
   `comments` (decision 10) live there. Every equality, hash, diff and fingerprint ignores them.
   s1's `Annotations.references` was dropped: the printer tokenizes strings itself (s3 D4).
4. **A stored `null` param is absent** (s3 requirement d). `''` is kept.
5. **`SimNode` has two more variants than s1.** The first is `{ $sim: 'literal', value }`: it
   escapes a stored object that already has a `$sim` key, so the encoding stays a bijection. The
   second: `unresolved.kind` may be `'var'`.
6. **`ResourceKind` is a closed union**: `credential`, `table`, `knowledgeBase`, `workflow`,
   `skill`, `customTool`, `mcpServer`, `sandbox`, `file`, `folder`. A new kind is a contract
   change.
7. **Ports use s1's names.** The default port is `out`, not s3's `source`. `PortKey` is the
   string form used for edge sorting and `edges:` anchors: `out`, `error`, `branch:<key>`,
   `subflowStart`, `subflowEnd` or `raw:<handle>`. Edges sort by `(from, portKey, to)` with
   `compareStrings`.

## Lock

8. **The lock has two halves.** The first, `LockIdentity`, holds ids, type, name, parent, branches
   and items. Canonicalize derives it and materialize returns it, and the fingerprint hashes it.
   The second, `WorkflowLockBlock`, adds `binding`, `order`, `contentHash`, `layout` and
   `codeFile`. The source use case assembles the full `WorkflowLockV1` from identity plus
   print/compile `LockHints` plus `workflowId`/`catalogHash`/fingerprint. Canonicalize does not
   return a full lock: it cannot know the fingerprint, which hashes its own output.
9. **`codeFile` is per block**, not a top-level `codeFiles` map keyed by id (s3).
10. **`LockHints` are keyed by block key** (s3 keyed them by id): neither print nor compile sees
    ids. They hold the same fields `workflow.code_meta` will store (decision 6).
11. **`order` is not unique.** Ties fall back to the key, so a lock merged from two branches
    stays valid.
12. **The validator is strict.** It rejects any unknown field. Keys must already be in
    normalized form and must match `normalizeWorkflowBlockName(name)` or that name's `~n`
    collision form. `binding` must be a non-reserved identifier, unique in the lock. Ids must be
    unique per scope: blocks, variables, branches within a block, items within a subBlock.
    Parents must exist and must not form a cycle. `contentHash` is 64 lowercase hex characters,
    and `baseFingerprint` is `sf1:` plus 64 lowercase hex characters. `codeFile` must be a
    normalized relative POSIX path. Every problem is reported at once, with an RFC 6901 `path`.
    A string input is parsed as JSON text.

## Diagnostics

13. **The prefix fixes severity, and the type enforces it.** `E_` is an error, `W_` a warning, `I_`
    info. `Diagnostic` is a union over codes, so a mismatched severity does not type-check.
    Because of this, s3's `E_FIELD_NOT_APPLICABLE` is renamed **`W_FIELD_NOT_APPLICABLE`**
    (build-spec decision 2 makes it a warning).
14. **Stage segments.** Compile and print codes have no stage segment and keep s3's names. The
    other stages use `LOCK_`, `CANON_`, `MAT_` and `APPLY_`. The engine's `SkippedItemType`
    values become `E_APPLY_<UPPER_SNAKE>` (`duplicate_trigger` becomes `E_APPLY_DUPLICATE_TRIGGER`).
    s4's extra codes map as follows:
    - `credential_unreachable` and `sandbox_plan_required` are errors;
    - `hosted_key_dropped`, `value_normalized`, `sunset_block`, `type_changed` and
      `pending_connections_dropped` are warnings;
    - `lock_id_claimed` became `W_MAT_LOCK_ID_CLAIMED`.
15. **Codes added beyond s3 §4**, because the grammar implies them:
    - syntax and limits: `E_WORKFLOW_EXPORT`, `E_LIMIT_EXCEEDED`;
    - scope: `E_UNKNOWN_VARIABLE`, `E_DUPLICATE_VARIABLE`, `E_INVALID_ENV_NAME`,
      `E_UNKNOWN_LOOP_PROPERTY`, `W_FORWARD_REF`;
    - branches: `E_UNKNOWN_BRANCH`, `E_DUPLICATE_BRANCH_KEY`, `E_BRANCH_ELSE_LAST`;
    - modes: `E_MODE_CONFLICT`, `W_INACTIVE_IS_ACTIVE`;
    - code files and handles: `E_CODE_FILE_MISSING`, `E_CODE_FILE_PATH`, `W_CODE_FILE_INLINED`,
      `W_RAW_HANDLE`.

    Add a code to `codes.ts` rather than reusing one with a different meaning.
16. **Location is grouped.** Instead of flat line and column fields, a diagnostic carries
    `span: SourceSpan`: file, 1-based line and column in UTF-16 units, end, and UTF-16 offsets
    `start`/`end`. It also carries `frame` and `fix` (offsets into `span.file`). Compile returns
    `LocatedDiagnostic`, which always has `span` and `frame`. Lock diagnostics carry `path`
    instead. Babel reports 0-based columns: add 1.
17. **`codeFrame` scope.** It shows two context lines around the span's start line. Every line
    inside the span gets `>`, and the caret row sits under the start line only. It splits lines
    the way Babel does (CRLF, LF, CR, U+2028, U+2029), so line numbers agree with Babel `loc`.

## Catalog

18. **Fields added to s1's shape:**
    - `CatalogBlock.graph`: `canBeTarget`, `errorPort`, `container`, `annotationOnly`, and the
      `branches` subBlock;
    - `CatalogBlock.dynamicOutputs` and `singleInstance`;
    - `CatalogSubBlock.surface`, which separates the action and trigger copies of one id.
19. **`valueKind`** is one of `string | number | boolean | array | object | json | code |
    branches | tools | resource | picked | upload | none`. `resource`, `picked` and `upload` are
    the selector kinds, so a pair member of those kinds is the basic member (build-spec
    decision 7). `resourceKind` is set iff `valueKind` is `resource`.
20. **`options` can be opaque.** It is a static list, `{ dynamic: true }` (fetched through a
    selector), or `{ opaque: true }` (an unevaluated function).
21. **`builders` are keyed by dotted SDK path** (`slack.sendMessage`, `trigger.gmail.newEmail`).
    `fixed` never repeats `operation`.

## Engines

22. **`IdentityEntry` is a union on `status`** (`matched` / `created` / `deleted`), not s1's
    flat `change` + `via`. A rename, a retype and a reparent can happen together.
    `created.idSource` replaces s4's `mintedIds`.
23. **`diffCanonical` takes an optional `renames`** map (target key → base key) from identity
    resolution. Without it, a rename shows up as a remove plus an add.
24. **`MaterializeHooks.initBlock`** receives `{ id, type, name, triggerMode }`.
25. **Hashing is unsolved: there is no SHA-256 to use.** `@sim/utils` has none, and `node:crypto`
    is banned by the boundary rule. The equivalence owner adds one pure-JS SHA-256 inside this
    package; `canonicalHash`, `contentHash` and `sourceFingerprint` all use it, and output is
    lowercase hex.

## Package wiring

- `tsconfig.json` sets `"types": []`, so no Node globals type-check here.
- `@xyflow/react` is a devDependency only so `@sim/workflow-types`' `Edge` import type-checks.
- `check:boundaries` rule 3 keeps `src/` (minus tests) free of Node built-ins (even type-only
  imports), dynamic `import()`, `require`, and value references to `eval` or `Function`.
- `knip.jsonc` sets `includeEntryExports: false` and ignores `@babel/parser` and `@sim/utils`
  until consumers and the compiler land. Remove both settings then.
- `@sim/workflow-sdk` is a scaffold with no `exports`, `type-check` or `test` script until 2E
  adds code. Its runtime entry is planned as `src/runtime.ts`, not s2's `runtime.js`.

## Amendments (Wave 1 audit)

- **A1. The CWM is encoding-free.** This supersedes item 4's storage note. `CanonicalParam` has
  no `storage`, so equality, hashes, diffs and the fingerprint never see the encoding.
  Materialize chooses it: prev's raw encoding first, then `CatalogSubBlock.storage`. `ParamStorage`
  now lives in `catalog/types.ts`.
- **A2. Two new materialize inputs.** `MaterializeOptions.compiledBindings` feeds identity rule 2.
  `MaterializeOptions.lockFreshness` (`fresh | stale | none`, required) gates rule 4 and the
  `W_MAT_DELETED_SINCE_PULL` handling.
- **A3. The lock is split.** This supersedes items 8 and 12.
  - `WorkflowLockV1` is `{ lockVersion, blocks, variables }`. Each block holds `id`, `parent`,
    `branches?`, `items?`, `binding`, `order`, `layout?` and `codeFile?`, and every id is logical.
  - These lock fields were removed: `workflowId`, `workspaceId`, `catalogHash`,
    `baseFingerprint`, `blocks[].type`, `blocks[].name` and `blocks[].contentHash`. The
    environment facts now live in `LockBase { workspaceId, baseFingerprint, catalogHash }`, which
    `source get/apply` carries beside the lock and a repo stores in
    `.sim/state/<env>/revision.json`.
  - The validator tolerates `x-` fields on the lock, on blocks and on layout, and preserves them.
    Item entries stay strict.
  - Version policy: adding an optional field does not bump `lockVersion`. Validators ship support
    for a field before writers emit it, and data waits under `x-` until then.
- **A4. One resource-kind list.** `WORKFLOW_RESOURCE_KINDS`, `WorkflowResourceKind` and
  `PortableResourceKind` moved to `@sim/workflow-types/resources`. This supersedes item 6.
  - apps/sim imports that list directly. The list moved out of `references/types.ts` rather than
    being re-exported from it, because the repo bans re-exports from non-barrel files. That file
    keeps its other types.
  - `ResourceKind` is now `Exclude<PortableResourceKind, 'env-var'>`, so its members are
    kebab-case: `knowledge-base`, `mcp-server`, `custom-tool`, `file-folder`, `workflow`, and so
    on.
  - `UnresolvedNode.kind` is widened to `string`.
  - Ids inside composite values are handled like this:
    - a scalar or array id becomes a `ResourceNode`;
    - in a `files` value, each object keeps its shape and only its `key` field becomes a node;
    - a `csv` value becomes the new `CsvNode { $sim: 'csv', items }`, and materialize joins the
      items with `,`.
- **A5. Catalog additions.**
  - `CatalogBlock.dynamicOutputs?: { source, param }` replaces the boolean.
  - New subBlock fields: `visibleFor?` (operation → visible, which 2A precomputes for function
    conditions), `columns?`, `step?` and `integer?`.
- **A6. Every stored type prints and compiles.**
  - `CatalogBlock.addable?: false` marks a type that may stay in a workflow but cannot be added.
    Compile reports a new block of that type as `E_TYPE_NOT_ADDABLE`.
  - A type with no builder (legacy, unknown, or `custom_block_*` without a method) uses the
    generic builder `block(type, name, params, meta?)` (`GENERIC_BUILDER`).
- **A7. `rows: null` has a source form.** It is an empty branch object: `condition('Name', {})`,
  or router `routes: {}`. The implicit default keys (`if` and `else`, `route0`) stay addressable as
  ports. A persisted list is never empty.
- **A8. Hashing is solved.** This supersedes item 25. `src/hash.ts` belongs to Wave 1.
  - `stableStringify` sorts keys with `compareStrings` and throws on anything that is not JSON.
  - `sha256Hex` is built on `@noble/hashes` 2.2.0.
  - `canonicalHash`, `sourceFingerprint` and any content digest must use these two.
- **A9. Items, edges and subflow configs.**
  - Lock `items` changed to `Record<subBlockId, Array<{ name, id }>>`, so duplicate and empty
    names keep their ids.
  - For O1, materialize reuses the whole prev edge object (id and handles) when the
    `(from, port, to)` tuple matches.
  - Materialize also writes prev's subflow config back verbatim when it is canonical-equal.
  - The optional fields of `LoopSpec` and `ParallelSpec` are absent exactly when storage omits
    them. Canonicalize never fills defaults.
- **A10. Anchors are structured.** This supersedes item 7's anchor strings.
  - `Anchor` is a discriminated union over `header`, `wiring`, `footer`, `block`, `param`,
    `inactive`, `edges` and `var`.
  - `AnchorKey` is now a branded string, produced only by `encodeAnchor` and read by
    `decodeAnchor`. Each segment escapes `%` and `:`.
  - For a basic/advanced pair, a `param` anchor uses the `canonicalParamId`.
  - `portKey` and `parsePortKey` are the only port string forms.
- **A11. Bindings avoid SDK names.** `SDK_RESERVED_IDENTIFIERS` (JS reserved words plus
  `SDK_CORE_EXPORTS`) is enforced on lock bindings.
  - **Note for 2E:** `core.d.ts` must export exactly `SDK_CORE_EXPORTS`, and `BlockMeta` needs
    `advancedMode?: boolean`, because the CWM keeps that legacy flag.
- **A12. Diagnostic changes.** `Diagnostic.related?: Array<{ span, message }>` was added, along
  with the codes `E_APPLY_LINT` and `E_TYPE_NOT_ADDABLE`. `E_MAT_LOCK_WORKFLOW_MISMATCH` was
  removed, because the lock no longer carries a workflow or workspace.
- **A13. The boundary rule is tighter.** Rule 3 also bans `.constructor` reads, `import.meta`, and
  value references to `globalThis`, `window`, `self`, `global`, `Reflect` and `require`. That
  covers computed `globalThis[...]` access.
- **A14. `codeFrame` clamps bad input.** NaN becomes line or column 1, ±Infinity a bound.
- **A15. knip.** Wave 3 removes `includeEntryExports: false` and the `@babel/parser` ignore from
  `knip.jsonc` once the consumers land. The `@sim/utils` ignore is already gone, because
  `hash.ts` uses it.
- **A16. `workflow.code_meta` (Wave 3E).** `WorkflowCodeMetaV1` in `src/code-meta.ts` is
  `{ v: 1, bindings, order, comments }`, the server-side copy of what the lock's `LockHints`
  carry, plus comments.
  - Every entry is keyed by **block id**, never by key, so a canvas rename never orphans one.
    Comment anchors are `encodeAnchor` keys whose block segment is the block id and whose `var`
    segment is the variable id.
  - There is no `branchKeys` map: branch keys persist on the rows as the optional row `key`
    (s1 D2b), so there is one source of truth for them.
  - `parseCodeMeta` mirrors `parseWorkflowLock`: strict, every problem at once, `x-` fields
    preserved. Its codes are `E_CODE_META_*`.
  - `CompileInput.knownKeys` (the lock's block keys) gates the new `meta.key` override, which is
    how source carries a legacy `name~n` collision key or a reserved name (`Loop`, `Parallel`)
    without being able to introduce one. A violation is `E_KEY_OVERRIDE`.
