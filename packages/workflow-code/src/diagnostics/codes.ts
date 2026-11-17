/**
 * Every diagnostic code `@sim/workflow-code` and the source apply path can emit. CLI output, the
 * copilot and tests match on them, so they freeze at release.
 *
 * The first letter fixes the severity (`E_` error, `W_` warning, `I_` info; see
 * {@link SeverityOf}). The segment after it names the stage that owns the code:
 * - no stage segment: compile and print, which share one vocabulary;
 * - `LOCK_`: `parseWorkflowLock`;
 * - `CANON_`: canonicalize;
 * - `MAT_`: materialize and identity resolution;
 * - `APPLY_`: the server apply pipeline and its gates.
 */

/** Syntax, header and file-shape errors from compile. */
type CompileSyntaxCode =
  /** A Babel parse error, re-coded. */
  | 'E_SYNTAX'
  /** The first line is not `// @sim-sdk N`. */
  | 'E_SDK_HEADER'
  /** The header's major is above the server's supported major. */
  | 'E_SDK_MAJOR'
  /** The header's major is below the oldest major the server reads (`OLDEST_SDK_MAJOR`). */
  | 'E_SDK_MAJOR_OLD'
  /** A construct outside the accepted grammar; `hint` names the supported form. */
  | 'E_UNSUPPORTED_SYNTAX'
  /** Not exactly one `export default workflow(...)`. */
  | 'E_WORKFLOW_EXPORT'
  /** Source exceeds the block, edge, byte, depth or `codeFile()` reference cap. */
  | 'E_LIMIT_EXCEEDED'
  /**
   * A NUL character or an unpaired UTF-16 surrogate, raw or escaped in a literal: a workflow
   * cannot store either (`compile/characters.ts`).
   */
  | 'E_INVALID_CHARACTER'
  /** A numeric literal that reads as `Infinity` (`1e999`), which JSON stores as `null`. */
  | 'E_NUMBER_NOT_FINITE'
  /** A numeric literal whose digits a double cannot hold (`12345678901234567890`). */
  | 'W_NUMBER_PRECISION'
  /**
   * The compile stopped at `MAX_ERRORS` errors; this one sits where the next error was found.
   * Fixing the errors listed and compiling again shows the rest.
   */
  | 'E_TOO_MANY_ERRORS'
  /** `MAX_WARNINGS` warnings were listed; this one sits where the next was found, and the rest are omitted. */
  | 'W_TOO_MANY_WARNINGS'

/** Names, identifiers and scope. */
type CompileScopeCode =
  /** Two block names normalize to the same key. */
  | 'E_DUPLICATE_NAME'
  /** A block name normalizes to a reserved reference prefix (`loop`, `parallel`, `variable`). */
  | 'E_RESERVED_NAME'
  /**
   * A `meta.key` override that is not a legacy key already bound to an id: it must be a key in
   * `CompileInput.knownKeys` and either the `~n` collision form of the block's name (with the
   * plain key declared too) or the block's reserved name. It never introduces a new key.
   */
  | 'E_KEY_OVERRIDE'
  /** A block's display name is the empty string. */
  | 'E_EMPTY_NAME'
  /** A block name holds a bidi control or zero-width character (`isSuspiciousCharacter`). */
  | 'W_SUSPICIOUS_CHARACTER'
  /** A block or workflow name that is not a string literal. */
  | 'E_NAME_NOT_LITERAL'
  /** Includes a Levenshtein "did you mean" in `hint`. */
  | 'E_UNKNOWN_IDENTIFIER'
  /** A ref into a sibling subflow's child. */
  | 'E_OUT_OF_SCOPE'
  /** `vars.x` names no declared variable. */
  | 'E_UNKNOWN_VARIABLE'
  /** Two workflow variable names normalize to the same key. */
  | 'E_DUPLICATE_VARIABLE'
  /** A variable's written `name` does not normalize to its key, so its references would not resolve. */
  | 'E_VARIABLE_NAME_MISMATCH'
  /** `env.X` where X does not match `PATTERNS.ENV_VAR_NAME`. */
  | 'E_INVALID_ENV_NAME'
  /** `env.X` where X is none of the env names the caller's runs resolve, when those are known. */
  | 'W_ENV_UNKNOWN'
  /** `p.<prop>` not in the loop/parallel resolvers' `KNOWN_PROPERTIES`. */
  | 'E_UNKNOWN_SUBFLOW_PROPERTY'
  /** A ref to a block declared later; it resolves, but the order is unusual. */
  | 'W_FORWARD_REF'
  /**
   * Hand-written `<Name.path>` text whose head is not a normalized block key or names no block;
   * kept verbatim, so a rename never rewrites it. `hint` names the ident form.
   */
  | 'W_REF_NOT_NORMALIZED'
  /**
   * A reference to a block whose key holds a character a stored reference cannot carry (`&`, `>`,
   * `[`...): the runtime would read the token as text or as another block.
   */
  | 'E_REF_UNREPRESENTABLE'

/** Wiring. */
type CompileEdgeCode =
  /** Reuses `getWorkflowEdgeScopeDropReason`. */
  | 'E_EDGE_SCOPE'
  /** An edge to or from a note block. */
  | 'E_EDGE_NOTE'
  /** An edge into a trigger block, which takes no incoming edges. */
  | 'E_TARGET_TRIGGER'
  /** `.to()` called directly on a condition or router. */
  | 'E_NO_DEFAULT_OUTPUT'
  /** The same source port wired to the same target twice. */
  | 'E_DUPLICATE_EDGE'
  /** `.onError()` on a block whose catalog entry has no error port. */
  | 'E_ERROR_PORT_UNSUPPORTED'
  /** `x.key.to()` where `key` is not a branch of `x`. */
  | 'E_UNKNOWN_BRANCH'
  /** A condition or router branch key written twice. */
  | 'E_DUPLICATE_BRANCH_KEY'
  /** A branch key equal to an output name, `to` or `onError`. */
  | 'E_BRANCH_KEY_COLLIDES'
  /** A condition with two or more rows does not end with `else`. */
  | 'E_BRANCH_ELSE_LAST'
  /** `edge(a, 'raw', b)`: an unknown handle kept verbatim. */
  | 'W_RAW_HANDLE'

/** Checks against the block catalog. */
type CompileCatalogCode =
  /** A block call or agent tool that names no catalog builder; `hint` has a did-you-mean. */
  | 'E_UNKNOWN_BUILDER'
  /** `hint` carries a did-you-mean over the params visible for the chosen operation. */
  | 'E_UNKNOWN_PARAM'
  /** The builder already pins this param (`operation` or a `fixed` entry). */
  | 'E_FIXED_PARAM'
  /**
   * A param not visible under the block's current values. A warning, not an error, because stale
   * hidden values are preserved.
   */
  | 'W_FIELD_NOT_APPLICABLE'
  /** Includes `todo()` placeholders. */
  | 'W_REQUIRED_MISSING'
  /**
   * `stored()` on a param the stored workflow holds no value for: a new block, a block of another
   * type, or an empty field (`CompileInput.stored`).
   */
  | 'E_STORED_VALUE_MISSING'
  /** The value's JSON type differs from the field's `valueKind`; never coerced. */
  | 'W_VALUE_KIND'
  /** A literal table filter the runtime refuses: the legacy `$` grammar or mixed shapes. */
  | 'W_TABLE_FILTER_SHAPE'
  /**
   * A loop/parallel count or batch size the runtime replaces or clamps; kept so stored values
   * round-trip.
   */
  | 'W_SUBFLOW_COUNT'
  /** Skipped when the block's outputs are dynamic. */
  | 'W_UNKNOWN_OUTPUT_PATH'
  /**
   * A bare reference in a JSON field literal whose output type nothing declares: it is stored bare
   * (typed), so a string value would break the JSON (`json-fields.ts`).
   */
  | 'W_JSON_REF_UNTYPED'

/** Function-code files. */
type CodeFileCode =
  /** `fn('./x.js')` names a file absent from `CompileInput.files`. */
  | 'E_CODE_FILE_MISSING'
  /** Not a relative path inside the repo, or the extension does not match the block language. */
  | 'E_CODE_FILE_PATH'
  /** The printer's bijection self-check failed; the code was printed inline as `js```. */
  | 'W_CODE_FILE_INLINED'

/** References and comments, shared by compile and print. */
type ReferenceCode =
  /**
   * A `<x.y>` token that resolves to nothing; kept as literal text. Compile also reports it for a
   * code file `$ref` chain that names no block or variable (`checkCodeFileRefs`).
   */
  | 'W_UNRESOLVED_REF'
  /** A ref that would point forward (a ref cycle), printed as literal text. */
  | 'W_FORWARD_REF_LITERALIZED'
  /** A comment outside an anchor position, hoisted to the nearest anchor. */
  | 'W_COMMENT_MOVED'
  /** A comment whose anchor block no longer exists. */
  | 'W_COMMENT_DROPPED'

export type CompileDiagnosticCode =
  | CompileSyntaxCode
  | CompileScopeCode
  | CompileEdgeCode
  | CompileCatalogCode
  | CodeFileCode
  | ReferenceCode

/** Print emits only reference, comment and code-file fallbacks; every print compiles. */
export type PrintDiagnosticCode = ReferenceCode | 'W_CODE_FILE_INLINED' | 'W_RAW_HANDLE'

/** `parseWorkflowLock` (lock.ts). */
export type LockDiagnosticCode =
  /** The lock text is not valid JSON. */
  | 'E_LOCK_JSON'
  /** `version` is missing or not `1`. */
  | 'E_LOCK_VERSION'
  /** A required field is missing or has the wrong type or format. */
  | 'E_LOCK_SHAPE'
  /** A field the schema does not define (typos are caught, not ignored). */
  | 'E_LOCK_UNKNOWN_FIELD'
  /** A block or variable key that is not in normalized form. */
  | 'E_LOCK_KEY'
  /** A `ident` that is not a JS identifier, or is in `SDK_RESERVED_IDENTIFIERS`. */
  | 'E_LOCK_IDENT'
  /** Two lock blocks claim the same `ident`. */
  | 'E_LOCK_DUPLICATE_IDENT'
  /** The same block, variable or branch id under two keys. */
  | 'E_LOCK_DUPLICATE_ID'
  /** A `parent` naming no lock block, itself, or forming a cycle. */
  | 'E_LOCK_PARENT'
  /** A branch key that is not a JS identifier. */
  | 'E_LOCK_BRANCH'
  /** A `codeFile` that is absolute, escapes the repo, or uses backslashes. */
  | 'E_LOCK_CODE_FILE_PATH'

/** `parseSourceMeta` (source-meta.ts), for the stored `workflow_source_meta` value. */
export type SourceMetaDiagnosticCode =
  /** The text is not valid JSON. */
  | 'E_SOURCE_META_JSON'
  /** `version` is missing or not `1`. */
  | 'E_SOURCE_META_VERSION'
  /** A required field is missing or has the wrong type or format. */
  | 'E_SOURCE_META_SHAPE'
  /** A field the schema does not define. */
  | 'E_SOURCE_META_UNKNOWN_FIELD'
  /** An ident that is not a JS identifier, or is in `SDK_RESERVED_IDENTIFIERS`. */
  | 'E_SOURCE_META_IDENT'
  /** Two blocks claim the same ident. */
  | 'E_SOURCE_META_DUPLICATE_IDENT'
  /** A `comments` key that `decodeAnchor` does not accept. */
  | 'E_SOURCE_META_ANCHOR'

/** canonicalize. */
export type CanonicalizeDiagnosticCode =
  /** Two stored names normalize to one key; the loser is keyed `key~n`. */
  | 'E_CANON_LEGACY_NAME_COLLISION'
  /** A stored edge crosses subflow scopes (`getWorkflowEdgeScopeDropReason`). */
  | 'E_CANON_EDGE_SCOPE'
  /** A stored block name normalizes to a reserved prefix (`loop`, `parallel`, `variable`). */
  | 'W_CANON_RESERVED_NAME'
  /** An edge whose source or target block does not exist; dropped. */
  | 'W_CANON_DANGLING_EDGE'
  /**
   * A block whose `data.parentId` names no stored block. It is placed at the root and the raw
   * `parentId` is kept under `extra`, so nothing is lost.
   */
  | 'W_CANON_DANGLING_PARENT'
  /** An unknown edge handle, kept as a `raw` port. */
  | 'W_CANON_RAW_HANDLE'
  /** A block type absent from the catalog; params kept, nothing marked inactive. */
  | 'W_CANON_UNKNOWN_BLOCK_TYPE'
  /** An internal id the resolver could not map to a key (`UnresolvedNode`). */
  | 'W_CANON_UNRESOLVED_ID'
  /** A stored branch title that disagrees with its positional title. */
  | 'W_CANON_TITLE_OVERRIDE'
  /** A loop/parallel config the loader would repair (count 0, type fallback). */
  | 'W_CANON_SUBFLOW_REPAIRED'
  /** Stored `subBlock.type` differs from the catalog's, or map key ≠ `subBlock.id`. */
  | 'W_CANON_SUBBLOCK_TYPE_DRIFT'
  /**
   * A stored JSON-string field that does not parse, kept as a native string; or a branch list
   * that is not rows with distinct ids, kept verbatim as a param.
   */
  | 'W_CANON_UNDECODABLE_JSON'

/** materialize and identity resolution. */
export type MaterializeDiagnosticCode =
  /** Two lock keys carry the same block id. */
  | 'E_MAT_DUPLICATE_LOCK_ID'
  /** A resource key the resolver cannot map to an id in this workspace. */
  | 'E_MAT_UNKNOWN_RESOURCE'
  /** A lock entry whose id has left prev; the block is re-created. */
  | 'W_MAT_DELETED_SINCE_PULL'
  /** Identity rule 4: a lockless rename inferred from type, parent and edge neighbourhood. */
  | 'W_MAT_INFERRED_RENAME'
  /** A key match with a different type: delete + create; webhook URL and schedules are lost. */
  | 'W_MAT_RETYPE_RECREATED'
  /** A lock-supplied id already belongs to another workflow; a fresh id was minted. */
  | 'W_MAT_LOCK_ID_CLAIMED'
  /** A new block with no prev or lock position; it is placed by targeted autolayout. */
  | 'I_MAT_NEEDS_LAYOUT'

/**
 * The server apply pipeline. Gate codes mirror the editing engine's `SkippedItemType`
 * (apps/sim/lib/workflows/editing/types.ts `WORKFLOW_SKIPPED_ITEM_TYPES`) minus
 * `invalid_edge_target`, as `E_APPLY_<UPPER_SNAKE>` (`block_locked` shares `E_APPLY_LOCKED_BLOCK`);
 * the rest are apply-only checks. The engine skips such an item silently, while source apply
 * refuses the whole write.
 */
export type ApplyDiagnosticCode =
  /** The base fingerprint no longer matches the stored graph (HTTP 409). */
  | 'E_APPLY_STALE'
  /** `base.workflowId` names another workflow: the source was read from a different one (HTTP 400). */
  | 'E_APPLY_WORKFLOW_MISMATCH'
  /** The diff touches a locked block or a child of a locked container. */
  | 'E_APPLY_LOCKED_BLOCK'
  /** A new block of a catalog type marked `addable: false`; existing blocks keep applying. */
  | 'E_APPLY_TYPE_NOT_ADDABLE'
  /** `validateWorkflowState` rejected the materialized graph. */
  | 'E_APPLY_INVALID_STATE'
  /** An edit or delete names a block the stored workflow does not hold. */
  | 'E_APPLY_BLOCK_NOT_FOUND'
  /** A block type the registry does not define. */
  | 'E_APPLY_INVALID_BLOCK_TYPE'
  /** A block type unavailable in this deployment, sunset, or blocked by access control. */
  | 'E_APPLY_BLOCK_NOT_ALLOWED'
  /** A model blocked by access control. */
  | 'E_APPLY_MODEL_NOT_ALLOWED'
  /** An agent tool unavailable in this deployment or not allowed by the permission group. */
  | 'E_APPLY_TOOL_NOT_ALLOWED'
  /** An edge whose source block does not exist or has no type. */
  | 'E_APPLY_INVALID_EDGE_SOURCE'
  /** An edge that crosses subflow scopes. */
  | 'E_APPLY_INVALID_EDGE_SCOPE'
  /** An edge from a handle its source block does not have. */
  | 'E_APPLY_INVALID_SOURCE_HANDLE'
  /** An edge into a handle its target block does not have. */
  | 'E_APPLY_INVALID_TARGET_HANDLE'
  /** A changed field whose value fails its subBlock type's validation. */
  | 'E_APPLY_INVALID_SUBBLOCK_FIELD'
  /** An operation the engine cannot run because a required argument is missing or empty. */
  | 'E_APPLY_MISSING_REQUIRED_PARAMS'
  /** Retry config on a trigger, human-in-the-loop or container block, which always runs once. */
  | 'E_APPLY_RETRY_NOT_SUPPORTED'
  /** A second trigger of a type a workflow can hold only once. */
  | 'E_APPLY_DUPLICATE_TRIGGER'
  /** A second block of a type a workflow can hold only once. */
  | 'E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK'
  /** Enabling a block whose enclosing container stays disabled. */
  | 'E_APPLY_DISABLED_ANCESTOR'
  /** A credential the acting user cannot reach. */
  | 'E_APPLY_CREDENTIAL_UNREACHABLE'
  /** The sandbox selection needs a plan the workspace does not have. */
  | 'E_APPLY_SANDBOX_PLAN_REQUIRED'
  /** A hosted key that does not apply to the acting user was dropped. */
  | 'W_APPLY_HOSTED_KEY_DROPPED'
  /** Value validation rewrote a value; the response files are re-printed. */
  | 'W_APPLY_VALUE_NORMALIZED'
  /** A block's type changed; its id, webhook URL and schedules are replaced. */
  | 'W_APPLY_TYPE_CHANGED'
  /**
   * The draft drops or retypes a block with a live webhook, schedule, chat output or MCP tool.
   * The deployment keeps them until the next deploy, which removes them.
   */
  | 'W_APPLY_TRIGGER_REMOVED'
  /** Compile failed and the catalog changed since the source was read: get the source again. */
  | 'W_APPLY_CATALOG_MOVED'
  /** A blocking workflow lint finding, mapped to a source line. */
  | 'E_APPLY_LINT'
  /** A non-blocking workflow lint finding, mapped to a source line. */
  | 'W_APPLY_LINT'

export type DiagnosticCode =
  | CompileDiagnosticCode
  | LockDiagnosticCode
  | SourceMetaDiagnosticCode
  | CanonicalizeDiagnosticCode
  | MaterializeDiagnosticCode
  | ApplyDiagnosticCode

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** The severity a code's prefix fixes. */
export type SeverityOf<C extends DiagnosticCode> = C extends `E_${string}`
  ? 'error'
  : C extends `W_${string}`
    ? 'warning'
    : 'info'
