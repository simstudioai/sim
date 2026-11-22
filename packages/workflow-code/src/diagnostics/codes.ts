/**
 * Every diagnostic code `@sim/workflow-code` and the source apply path can emit. CLI output, the
 * copilot and tests match on them, so they freeze at release.
 *
 * The first letter fixes the severity (`E_` error, `W_` warning, `I_` info; see `SeverityOf` in
 * `./severity`). The segment after it usually names the stage that owns the code:
 * - no stage segment: compile and print, which share one vocabulary;
 * - `LOCK_`: `parseWorkflowLock`;
 * - `SOURCE_META_`: `parseSourceMeta`;
 * - `CANON_`: canonicalize;
 * - `MAT_`: materialize and identity resolution;
 * - `APPLY_`: the server apply pipeline and its gates. That array also holds the apply's checks
 *   whose codes name what they check instead (`W_TABLE_UNKNOWN_COLUMN`, `E_NAME_TAKEN`,
 *   `E_WORKFLOW_META_INVALID`).
 *
 * Every code is declared in exactly one array; {@link DiagnosticCode} is `never` if one is not.
 */

/** Syntax, header and file-shape errors from compile. */
const COMPILE_SYNTAX_CODES = [
  /** A Babel parse error, re-coded. */
  'E_SYNTAX',
  /** The first line is not `// @sim-sdk N`. */
  'E_SDK_HEADER',
  /** The header's major is above the server's supported major. */
  'E_SDK_MAJOR',
  /** The header's major is below the oldest major the server reads (`OLDEST_SDK_MAJOR`). */
  'E_SDK_MAJOR_OLD',
  /** A construct outside the accepted grammar; `hint` names the supported form. */
  'E_UNSUPPORTED_SYNTAX',
  /** Not exactly one `export default workflow(...)`. */
  'E_WORKFLOW_EXPORT',
  /** Source exceeds the block, edge, byte, depth or `codeFile()` reference cap. */
  'E_LIMIT_EXCEEDED',
  /**
   * A NUL character or an unpaired UTF-16 surrogate, raw or escaped in a literal: a workflow
   * cannot store either (`compile/characters.ts`).
   */
  'E_INVALID_CHARACTER',
  /** A numeric literal that reads as `Infinity` (`1e999`), which JSON stores as `null`. */
  'E_NUMBER_NOT_FINITE',
  /** A numeric literal whose digits a double cannot hold (`12345678901234567890`). */
  'W_NUMBER_PRECISION',
  /**
   * The compile stopped at `MAX_ERRORS` errors; this one sits where the next error was found.
   * Fixing the errors listed and compiling again shows the rest.
   */
  'E_TOO_MANY_ERRORS',
] as const

/**
 * The one truncation marker, in every vocabulary: a list of findings was cut, and this info ends
 * it. The compile records it where its warning caps (`FINDING_LIMITS`) leave the next warning (of
 * that code) out; an answer's list it cuts (`boundAnswerFindings`) ends in one that counts what it
 * left out, in place of the compile's.
 * Informational: the findings it follows decide whether a write is refused.
 */
const TRUNCATION_CODES = ['I_FINDINGS_TRUNCATED'] as const

/** Names, identifiers and scope. */
const COMPILE_SCOPE_CODES = [
  /** Two block names normalize to the same key. */
  'E_DUPLICATE_NAME',
  /** A block name normalizes to a reserved reference prefix (`loop`, `parallel`, `variable`). */
  'E_RESERVED_NAME',
  /**
   * A `meta.key` override that is not a legacy key already bound to an id: it must be a key in
   * `CompileInput.knownKeys` and either the `~n` collision form of the block's name (with the
   * plain key declared too) or the block's reserved name. It never introduces a new key.
   */
  'E_KEY_OVERRIDE',
  /** A block's display name is the empty string. */
  'E_EMPTY_NAME',
  /**
   * Two block names whose keys differ but are equal once NFC-normalized (`café` precomposed and
   * decomposed): distinct blocks no reader can tell apart.
   */
  'E_LOOKALIKE_NAME',
  /** A look-alike pair (`E_LOOKALIKE_NAME`) the stored workflow already holds, kept so it round-trips. */
  'W_LOOKALIKE_NAME',
  /** A block or workflow name holds an invisible or bidi control character (`isSuspiciousCharacter`). */
  'W_SUSPICIOUS_CHARACTER',
  /** A block or workflow name that is not a string literal. */
  'E_NAME_NOT_LITERAL',
  /** Includes a Levenshtein "did you mean" in `hint`. */
  'E_UNKNOWN_IDENTIFIER',
  /** A ref into a sibling subflow's child. */
  'E_OUT_OF_SCOPE',
  /** `vars.x` names no declared variable. */
  'E_UNKNOWN_VARIABLE',
  /** Two workflow variable names normalize to the same key. */
  'E_DUPLICATE_VARIABLE',
  /** A variable's written `name` does not normalize to its key, so its references would not resolve. */
  'E_VARIABLE_NAME_MISMATCH',
  /** `env.X` where X does not match `PATTERNS.ENV_VAR_NAME`. */
  'E_INVALID_ENV_NAME',
  /** `env.X` where X is none of the env names the caller's runs resolve, when those are known. */
  'W_ENV_UNKNOWN',
  /**
   * A child workflow call's `inputMapping` names an input the child's Start trigger does not
   * declare (an offline check of a workspace directory); the child never receives it.
   */
  'W_CHILD_INPUT_UNKNOWN',
  /**
   * A child workflow call names a workflow with no Start trigger (an offline check of a workspace
   * directory), so it has no inputs to map and no entry point to run from.
   */
  'W_CHILD_NO_START',
  /**
   * A reference to a child workflow call's `result.<key>` whose child ends at a Response block on
   * every run (an offline check of a workspace directory), where `<key>` is not `data`, `status`
   * or `headers`: the child's result is its Response output, so the path reads nothing. The value
   * meant is almost always `result.data.<key>`.
   */
  'W_CHILD_RESULT_PATH',
  /** `p.<prop>` not in the loop/parallel resolvers' `KNOWN_PROPERTIES`. */
  'E_UNKNOWN_SUBFLOW_PROPERTY',
  /** A ref to a block declared later; it resolves, but the order is unusual. */
  'W_FORWARD_REF',
  /**
   * Hand-written `<Name.path>` text whose head is not a normalized block key or names no block;
   * kept verbatim, so a rename never rewrites it. `hint` names the ident form.
   */
  'W_REF_NOT_NORMALIZED',
  /**
   * A reference to a block whose key holds a character a stored reference cannot carry (`&`, `>`,
   * `[`...): the runtime would read the token as text or as another block.
   */
  'E_REF_UNREPRESENTABLE',
  /**
   * A loop or parallel iteration field (`index`, `currentItem`, `items`) read from a block outside
   * that container: `lp.index` after the loop, `$ref.loop.index` or `<loop.index>` in a block in
   * no loop. The run fails (or reads nothing) there. A warning so a stored workflow that holds one
   * still round-trips; the apply refuses it on a block the edit changed as
   * `E_APPLY_REF_OUT_OF_SCOPE`.
   */
  'W_REF_OUT_OF_SCOPE',
] as const

/** Wiring. */
const COMPILE_EDGE_CODES = [
  /** Reuses `getWorkflowEdgeScopeDropReason`. */
  'E_EDGE_SCOPE',
  /** An edge to or from a note block. */
  'E_EDGE_NOTE',
  /** An edge into a trigger block, which takes no incoming edges. */
  'E_TARGET_TRIGGER',
  /** `.to()` called directly on a condition or router. */
  'E_NO_DEFAULT_OUTPUT',
  /** The same source port wired to the same target twice. */
  'E_DUPLICATE_EDGE',
  /** `.onError()` on a block whose catalog entry has no error port. */
  'E_ERROR_PORT_UNSUPPORTED',
  /**
   * `.onError()` on a block with no error port (a loop or parallel) that the stored workflow
   * already wires: kept so it round-trips; source never adds one. Unread (`storedUnread`), any such
   * edge between two bound blocks (with `storedUnreadEdges`, one the get printed), which an apply
   * keeps only if the stored workflow holds it.
   */
  'W_ERROR_PORT_STORED',
  /** `x.key.to()` where `key` is not a branch of `x`. */
  'E_UNKNOWN_BRANCH',
  /** A condition or router branch key written twice. */
  'E_DUPLICATE_BRANCH_KEY',
  /** A branch key equal to an output name, `to` or `onError`. */
  'E_BRANCH_KEY_COLLIDES',
  /** A condition with two or more rows does not end with `else`. */
  'E_BRANCH_ELSE_LAST',
  /** `edge(a, 'raw', b)`: an unknown handle kept verbatim. */
  'W_RAW_HANDLE',
  /**
   * `edge()` from a loop or parallel's start handle to a block outside it (the executor runs it as
   * the container's exit), or from any other of its handles into its own child. Kept as written,
   * so a stored edge of either shape round-trips; the canvas never draws one.
   */
  'W_SUBFLOW_HANDLE_SCOPE',
  /**
   * Wiring that closes a cycle among enabled blocks (a self-loop included). The executor makes each
   * block wait for every incoming edge, so no block on a cycle ever runs; repeat work with loop().
   */
  'E_EDGE_CYCLE',
  /**
   * A cycle the stored workflow already holds (unread, may hold: every edge between bound blocks):
   * kept so it round-trips, but none of it runs.
   */
  'W_EDGE_CYCLE',
  /**
   * A condition or router branch no edge leaves, so a run that takes it ends there. A branch the
   * stored workflow already leaves unwired is not reported.
   */
  'W_BRANCH_UNWIRED',
] as const

/** Checks against the block catalog. */
const COMPILE_CATALOG_CODES = [
  /** A block call or agent tool that names no catalog builder; `hint` has a did-you-mean. */
  'E_UNKNOWN_BUILDER',
  /** `hint` carries a did-you-mean over the params visible for the chosen operation. */
  'E_UNKNOWN_PARAM',
  /** The builder already pins this param (`operation` or a `fixed` entry). */
  'E_FIXED_PARAM',
  /**
   * A param not visible under the block's current values. A warning, not an error, because stale
   * hidden values are preserved.
   */
  'W_FIELD_NOT_APPLICABLE',
  /** Includes `todo()` placeholders. */
  'W_REQUIRED_MISSING',
  /** A dropdown value none of its static options names; `hint` lists them, with a did-you-mean. */
  'W_UNKNOWN_OPTION',
  /**
   * An `operation` the block does not offer: no tool would run. `hint` lists the operations. A
   * retired operation the stored block already holds is `W_UNKNOWN_OPTION` instead.
   */
  'E_UNKNOWN_OPERATION',
  /** A `model` the catalog does not list; kept, since custom and self-hosted models are free text. */
  'W_UNKNOWN_MODEL',
  /** A block of a legacy or deprecated type; `hint` names the type that replaces it. */
  'W_LEGACY_BLOCK_TYPE',
  /**
   * A new `block()` of a type the catalog does not hold: the server refuses to place it
   * (`E_APPLY_INVALID_BLOCK_TYPE`). A block the stored workflow or the lock already holds keeps
   * its type quietly, so a workflow saved with a retired type still round-trips.
   */
  'W_UNKNOWN_BLOCK_TYPE',
  /**
   * A new block of a type the catalog keeps only for blocks already using it (`addable: false`):
   * the server refuses to place it (`E_APPLY_TYPE_NOT_ADDABLE`). A block the stored workflow or
   * the lock may continue stays quiet, as for `W_UNKNOWN_BLOCK_TYPE`.
   */
  'W_TYPE_NOT_ADDABLE',
  /**
   * A schedule created from source with no `timezone`: the editor seeds the viewer's zone, but
   * a schedule with none runs in UTC.
   */
  'I_SCHEDULE_UTC',
  /**
   * `stored()` on a param the stored workflow holds no value for: a new block, a block of another
   * type, or an empty field (`CompileInput.stored`).
   */
  'E_STORED_VALUE_MISSING',
  /** The value's JSON type differs from the field's `valueKind`; never coerced. */
  'W_VALUE_KIND',
  /**
   * A literal slider value outside the catalog `min`/`max`, off its `step`, or fractional where it
   * takes integers. A warning: the executor forwards it unclamped and stored values keep
   * round-tripping, so the provider or tool decides at run time.
   */
  'W_OUT_OF_RANGE',
  /** A literal table filter the runtime refuses: the legacy `$` grammar or mixed shapes. */
  'W_TABLE_FILTER_SHAPE',
  /**
   * A password field holding literal text instead of an env reference, or another field holding a
   * detected credential (`secrets.ts`); printed as `stored()`.
   */
  'W_LITERAL_SECRET',
  /**
   * A loop/parallel count or batch size the runtime replaces or clamps; kept so stored values
   * round-trip.
   */
  'W_SUBFLOW_COUNT',
  /**
   * A path the referenced block's outputs do not have, which fails the run when it resolves.
   * Skipped when the block's outputs are dynamic and cannot be read. Refused as
   * `E_APPLY_UNRESOLVED_REF` in `workflow.ts` on a block the edit added or changed.
   */
  'W_UNKNOWN_OUTPUT_PATH',
  /**
   * A path the referenced block does not declare that the run still accepts: an input its
   * `inputFormat` does not declare (a caller may pass it), or `x.error` on a block with no error
   * edge (it reads nothing). Never refused, unlike `W_UNKNOWN_OUTPUT_PATH`.
   */
  'W_OUTPUT_PATH_UNDECLARED',
  /**
   * A bare reference in a JSON field literal whose output type nothing declares: it is stored bare
   * (typed), so a string value would break the JSON (`json-fields.ts`).
   */
  'W_JSON_REF_UNTYPED',
  /**
   * A while or do-while condition that is not a JavaScript expression once its references stand
   * in as values, which fails the run when it evaluates it. Refused as
   * `E_APPLY_LOOP_CONDITION_SYNTAX` on a loop the edit added or changed.
   */
  'W_LOOP_CONDITION_SYNTAX',
] as const

/** Function-code files. */
const CODE_FILE_CODES = [
  /** `fn('./x.js')` names a file absent from `CompileInput.files`. */
  'E_CODE_FILE_MISSING',
  /**
   * Not `./functions/<name>.<js|py|sh>` beside the entry file (`isCodeFilePath`), or the extension
   * does not match the block language.
   */
  'E_CODE_FILE_PATH',
  /** The printer's bijection self-check failed; the code was printed inline as `js```. */
  'W_CODE_FILE_INLINED',
  /**
   * `$ref.key.path` or `$env.NAME` in a Python or shell code file, which is saved as written (only
   * JavaScript files are rewritten), so the run reads it as text; `hint` names the `<key.path>` or
   * `{{NAME}}` form those files take. A warning so stored code that holds the text still
   * round-trips; refused as `E_APPLY_CODE_FILE_REF_SYNTAX` in a file the edit changed.
   */
  'W_CODE_FILE_REF_SYNTAX',
] as const

/** References and comments, shared by compile and print. */
const REFERENCE_CODES = [
  /**
   * A `<x.y>` token that resolves to nothing; kept as literal text. Compile also reports it for a
   * code file `$ref` chain that names no block or variable (`checkCodeFileRefs`).
   */
  'W_UNRESOLVED_REF',
  /** A ref that would point forward (a ref cycle), printed as literal text. */
  'W_FORWARD_REF_LITERALIZED',
  /** A comment outside an anchor position, hoisted to the nearest anchor. */
  'W_COMMENT_MOVED',
  /** A comment whose anchor block no longer exists. */
  'W_COMMENT_DROPPED',
] as const

const COMPILE_DIAGNOSTIC_CODES = [
  ...COMPILE_SYNTAX_CODES,
  ...TRUNCATION_CODES,
  ...COMPILE_SCOPE_CODES,
  ...COMPILE_EDGE_CODES,
  ...COMPILE_CATALOG_CODES,
  ...CODE_FILE_CODES,
  ...REFERENCE_CODES,
] as const
/** Errors one compile lists before it stops with `E_TOO_MANY_ERRORS`. */
export const MAX_ERRORS = 100

export type CompileDiagnosticCode = (typeof COMPILE_DIAGNOSTIC_CODES)[number]

/**
 * Print emits only compile's reference, comment and code-file fallbacks and literal secrets, so
 * that whatever it prints compiles back with the same findings.
 */
export type PrintDiagnosticCode = Extract<
  CompileDiagnosticCode,
  (typeof REFERENCE_CODES)[number] | 'W_CODE_FILE_INLINED' | 'W_RAW_HANDLE' | 'W_LITERAL_SECRET'
>

/** `parseWorkflowLock` (lock.ts). */
const LOCK_DIAGNOSTIC_CODES = [
  /** The lock text is not valid JSON. */
  'E_LOCK_JSON',
  /** `version` is missing or not `1`. */
  'E_LOCK_VERSION',
  /** A required field is missing or has the wrong type or format. */
  'E_LOCK_SHAPE',
  /** A field the schema does not define (typos are caught, not ignored). */
  'E_LOCK_UNKNOWN_FIELD',
  /** A block or variable key that is not in normalized form. */
  'E_LOCK_KEY',
  /** A `ident` that is not a JS identifier, or is in `SDK_RESERVED_IDENTIFIERS`. */
  'E_LOCK_IDENT',
  /** Two lock blocks claim the same `ident`. */
  'E_LOCK_DUPLICATE_IDENT',
  /** The same block, variable or branch id under two keys. */
  'E_LOCK_DUPLICATE_ID',
  /** A `parent` naming no lock block, itself, or forming a cycle. */
  'E_LOCK_PARENT',
  /** A branch key that is not a JS identifier. */
  'E_LOCK_BRANCH',
  /** A `codeFile` that is absolute, escapes the repo, or uses backslashes. */
  'E_LOCK_CODE_FILE_PATH',
] as const
export type LockDiagnosticCode = (typeof LOCK_DIAGNOSTIC_CODES)[number]

/** `parseSourceMeta` (source-meta.ts), for the stored `workflow_source_meta` value. */
const SOURCE_META_DIAGNOSTIC_CODES = [
  /** The text is not valid JSON. */
  'E_SOURCE_META_JSON',
  /** `version` is missing or not `1`. */
  'E_SOURCE_META_VERSION',
  /** A required field is missing or has the wrong type or format. */
  'E_SOURCE_META_SHAPE',
  /** A field the schema does not define. */
  'E_SOURCE_META_UNKNOWN_FIELD',
  /** An ident that is not a JS identifier, or is in `SDK_RESERVED_IDENTIFIERS`. */
  'E_SOURCE_META_IDENT',
  /** Two blocks claim the same ident. */
  'E_SOURCE_META_DUPLICATE_IDENT',
  /** A `comments` key that `decodeAnchor` does not accept. */
  'E_SOURCE_META_ANCHOR',
] as const
export type SourceMetaDiagnosticCode = (typeof SOURCE_META_DIAGNOSTIC_CODES)[number]

/** canonicalize. */
const CANONICALIZE_DIAGNOSTIC_CODES = [
  /** Two stored names normalize to one key; the loser is keyed `key~n`. */
  'E_CANON_LEGACY_NAME_COLLISION',
  /** A stored edge crosses subflow scopes (`getWorkflowEdgeScopeDropReason`). */
  'E_CANON_EDGE_SCOPE',
  /** A stored block name normalizes to a reserved prefix (`loop`, `parallel`, `variable`). */
  'W_CANON_RESERVED_NAME',
  /** An edge whose source or target block does not exist; dropped. */
  'W_CANON_DANGLING_EDGE',
  /**
   * A block whose `data.parentId` names no stored block. It is placed at the root and the raw
   * `parentId` is kept under `extra`, so nothing is lost.
   */
  'W_CANON_DANGLING_PARENT',
  /** An unknown edge handle, kept as a `raw` port. */
  'W_CANON_RAW_HANDLE',
  /** A block type absent from the catalog; params kept, nothing marked inactive. */
  'W_CANON_UNKNOWN_BLOCK_TYPE',
  /** An internal id the resolver could not map to a key (`UnresolvedNode`). */
  'W_CANON_UNRESOLVED_ID',
  /** A stored branch title that disagrees with its positional title. */
  'W_CANON_TITLE_OVERRIDE',
  /** A loop/parallel config the loader would repair (count 0, type fallback). */
  'W_CANON_SUBFLOW_REPAIRED',
  /** Stored `subBlock.type` differs from the catalog's, or map key ≠ `subBlock.id`. */
  'W_CANON_SUBBLOCK_TYPE_DRIFT',
  /**
   * A stored JSON-string field that does not parse, kept as a native string; or a branch list
   * that is not rows with distinct ids, kept verbatim as a param.
   */
  'W_CANON_UNDECODABLE_JSON',
] as const
export type CanonicalizeDiagnosticCode = (typeof CANONICALIZE_DIAGNOSTIC_CODES)[number]

/** materialize and identity resolution. */
const MATERIALIZE_DIAGNOSTIC_CODES = [
  /** Two lock keys carry the same block id. */
  'E_MAT_DUPLICATE_LOCK_ID',
  /** A resource key the resolver cannot map to an id in this workspace. */
  'E_MAT_UNKNOWN_RESOURCE',
  /** A `vars.x` reference to a variable the workflow does not declare. */
  'E_MAT_UNKNOWN_VARIABLE',
  /** A lock entry whose id has left prev; the block is re-created. */
  'W_MAT_DELETED_SINCE_PULL',
  /** Identity rule 4: a lockless rename inferred from type, parent and edge neighbourhood. */
  'W_MAT_INFERRED_RENAME',
  /** A key match with a different type: delete + create; webhook URL and schedules are lost. */
  'W_MAT_RETYPE_RECREATED',
  /** A lock-supplied id already belongs to another workflow; a fresh id was minted. */
  'W_MAT_LOCK_ID_CLAIMED',
  /** A new block with no prev or lock position; it is placed by targeted autolayout. */
  'I_MAT_NEEDS_LAYOUT',
] as const
export type MaterializeDiagnosticCode = (typeof MATERIALIZE_DIAGNOSTIC_CODES)[number]

/**
 * The server apply pipeline. Gate codes mirror the editing engine's `SkippedItemType`
 * (apps/sim/lib/workflows/editing/types.ts `WORKFLOW_SKIPPED_ITEM_TYPES`) minus
 * `invalid_edge_target`, as `E_APPLY_<UPPER_SNAKE>` (`block_locked` shares `E_APPLY_LOCKED_BLOCK`);
 * the rest are apply-only checks. The engine skips such an item silently, while source apply
 * refuses the whole write.
 */
const APPLY_DIAGNOSTIC_CODES = [
  /** The base fingerprint no longer matches the stored graph (HTTP 409). */
  'E_APPLY_STALE',
  /** `base.workflowId` names another workflow: the source was read from a different one (HTTP 400). */
  'E_APPLY_WORKFLOW_MISMATCH',
  /** The diff touches a locked block or a child of a locked container. */
  'E_APPLY_LOCKED_BLOCK',
  /** A new block of a catalog type marked `addable: false`; existing blocks keep applying. */
  'E_APPLY_TYPE_NOT_ADDABLE',
  /** `validateWorkflowState` rejected the materialized graph. */
  'E_APPLY_INVALID_STATE',
  /** An edit or delete names a block the stored workflow does not hold. */
  'E_APPLY_BLOCK_NOT_FOUND',
  /** A block type the registry does not define. */
  'E_APPLY_INVALID_BLOCK_TYPE',
  /** A block type unavailable in this deployment, sunset, or blocked by access control. */
  'E_APPLY_BLOCK_NOT_ALLOWED',
  /** A model blocked by access control. */
  'E_APPLY_MODEL_NOT_ALLOWED',
  /** An agent tool unavailable in this deployment or not allowed by the permission group. */
  'E_APPLY_TOOL_NOT_ALLOWED',
  /** An edge whose source block does not exist or has no type. */
  'E_APPLY_INVALID_EDGE_SOURCE',
  /** An edge that crosses subflow scopes. */
  'E_APPLY_INVALID_EDGE_SCOPE',
  /** An edge from a handle its source block does not have. */
  'E_APPLY_INVALID_SOURCE_HANDLE',
  /** An edge into a handle its target block does not have. */
  'E_APPLY_INVALID_TARGET_HANDLE',
  /** A changed field whose value fails its subBlock type's validation. */
  'E_APPLY_INVALID_SUBBLOCK_FIELD',
  /** An operation the engine cannot run because a required argument is missing or empty. */
  'E_APPLY_MISSING_REQUIRED_PARAMS',
  /** Retry config on a trigger, human-in-the-loop or container block, which always runs once. */
  'E_APPLY_RETRY_NOT_SUPPORTED',
  /** A second trigger of a type a workflow can hold only once. */
  'E_APPLY_DUPLICATE_TRIGGER',
  /** A second block of a type a workflow can hold only once. */
  'E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK',
  /** Enabling a block whose enclosing container stays disabled. */
  'E_APPLY_DISABLED_ANCESTOR',
  /** A credential the acting user cannot reach. */
  'E_APPLY_CREDENTIAL_UNREACHABLE',
  /**
   * A credential key the caller cannot resolve stands where the workflow stores a credential the
   * caller cannot see (source a teammate read): the stored credential is kept, whatever the key.
   */
  'W_APPLY_CREDENTIAL_KEPT',
  /** The sandbox selection needs a plan the workspace does not have. */
  'E_APPLY_SANDBOX_PLAN_REQUIRED',
  /** A hosted key that does not apply to the acting user was dropped. */
  'W_APPLY_HOSTED_KEY_DROPPED',
  /** Value validation rewrote a value; the response files are re-printed. */
  'W_APPLY_VALUE_NORMALIZED',
  /** A block's type changed; its id, webhook URL and schedules are replaced. */
  'W_APPLY_TYPE_CHANGED',
  /**
   * The draft drops or retypes a block with a live webhook, schedule, chat output or MCP tool.
   * The deployment keeps them until the next deploy, which removes them.
   */
  'W_APPLY_TRIGGER_REMOVED',
  /** Compile failed and the catalog changed since the source was read: get the source again. */
  'W_APPLY_CATALOG_MOVED',
  /**
   * An apply passed `allowDelete` deletes a block and adds one of the same type and parent: a
   * probable rename whose name and const both changed, which gets a new id.
   */
  'W_APPLY_PROBABLE_RENAME',
  /** A blocking workflow lint finding, mapped to a source line. */
  'E_APPLY_LINT',
  /**
   * A function code file `$ref` naming no block or variable in code the edit changed, which fails
   * at run time; on code the stored workflow already holds it stays `W_UNRESOLVED_REF`.
   */
  'E_APPLY_UNRESOLVED_REF',
  /**
   * A `W_REF_OUT_OF_SCOPE` iteration reference on a block the edit added, changed or moved, which
   * fails at run time.
   */
  'E_APPLY_REF_OUT_OF_SCOPE',
  /** A `W_CODE_FILE_REF_SYNTAX` in a code file the edit changed, which breaks the code at run time. */
  'E_APPLY_CODE_FILE_REF_SYNTAX',
  /** A `W_LOOP_CONDITION_SYNTAX` on a loop the edit added or changed, which fails at run time. */
  'E_APPLY_LOOP_CONDITION_SYNTAX',
  /** A non-blocking workflow lint finding, mapped to a source line. */
  'W_APPLY_LINT',
  /** A table row write (insert, upsert, update) with a key that is not a column of its table. */
  'W_TABLE_UNKNOWN_COLUMN',
  /**
   * An added or changed schedule whose timing cannot schedule (a malformed cron expression, an
   * unknown timezone, an out-of-range interval), checked as deploy checks it.
   */
  'E_APPLY_INVALID_SCHEDULE',
  /**
   * The apply removes blocks the source no longer declares and the caller did not pass
   * `allowDelete` (`--allow-delete`).
   */
  'E_APPLY_BLOCK_DELETE',
  /**
   * The apply removes workflow variables the source no longer declares and the caller did not pass
   * `allowDelete` (`--allow-delete`), as for blocks.
   */
  'E_APPLY_VARIABLE_DELETE',
  /** The source renames the workflow to a name another workflow in its folder holds. */
  'E_NAME_TAKEN',
  /**
   * The source sets a workflow name or description the workflow API refuses: an empty name, a name
   * over 255 characters, or a description over 50,000.
   */
  'E_WORKFLOW_META_INVALID',
] as const
export type ApplyDiagnosticCode = (typeof APPLY_DIAGNOSTIC_CODES)[number]

/**
 * Every code, as a value: the wire contracts' enum, so a client matching on a code is checked
 * against the vocabulary.
 */
export const DIAGNOSTIC_CODES = [
  ...COMPILE_DIAGNOSTIC_CODES,
  ...LOCK_DIAGNOSTIC_CODES,
  ...SOURCE_META_DIAGNOSTIC_CODES,
  ...CANONICALIZE_DIAGNOSTIC_CODES,
  ...MATERIALIZE_DIAGNOSTIC_CODES,
  ...APPLY_DIAGNOSTIC_CODES,
] as const

/** Whether a tuple of codes lists one of them twice. */
export type HasDuplicates<T extends readonly unknown[]> = T extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends Tail[number]
    ? true
    : HasDuplicates<Tail>
  : false

/**
 * One of {@link DIAGNOSTIC_CODES}. It is `never`, which fails every use, if a code is declared in
 * two arrays: each code has one owner and one place in the wire enum.
 */
export type DiagnosticCode = HasDuplicates<typeof DIAGNOSTIC_CODES> extends false
  ? (typeof DIAGNOSTIC_CODES)[number]
  : never

/**
 * Whether a finding with `code` may carry a code frame. A finding about a literal secret in
 * source carries its span only, so the frame never echoes the secret over the API into logs or
 * agent context.
 */
export function framesSource(code: DiagnosticCode): boolean {
  return code !== 'W_LITERAL_SECRET'
}
