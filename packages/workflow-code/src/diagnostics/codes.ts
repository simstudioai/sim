/**
 * Every diagnostic code `@sim/workflow-code` and the source apply path can emit. Codes are stable
 * wire values: CLI output, the copilot and tests match on them, so never rename one; retire it.
 *
 * The first letter fixes the severity (`E_` error, `W_` warning, `I_` info; see
 * {@link SeverityOf}). The segment after it names the stage that owns the code:
 * - no stage segment: compile (s3 §4) and print, which share one vocabulary;
 * - `LOCK_`: `parseWorkflowLock`;
 * - `CANON_`: canonicalize (s1 §2, §5);
 * - `MAT_`: materialize and identity resolution (s1 §4);
 * - `APPLY_`: the server apply pipeline and its gates (s4 §2, build-spec decision 11).
 */

/** Syntax, header and file-shape errors from compile (s3 §4 "Accepted grammar"). */
export type CompileSyntaxCode =
  /** A Babel parse error, re-coded. */
  | 'E_SYNTAX'
  /** The first line is not `// @sim-sdk N`. */
  | 'E_SDK_HEADER'
  /** The header's major is above the server's supported major. */
  | 'E_SDK_MAJOR'
  /** A construct outside the accepted grammar; `hint` names the supported form (s3 §4 table). */
  | 'E_UNSUPPORTED_SYNTAX'
  /** Not exactly one `export default workflow(...)`. */
  | 'E_WORKFLOW_EXPORT'
  /** Source exceeds the byte, AST node or depth cap (s4 D7). */
  | 'E_LIMIT_EXCEEDED'

/** Names, identifiers and scope (s3 §4 "Names and scopes"). */
export type CompileScopeCode =
  | 'E_DUPLICATE_NAME'
  | 'E_RESERVED_NAME'
  | 'E_EMPTY_NAME'
  | 'E_NAME_NOT_LITERAL'
  /** Includes a Levenshtein "did you mean" in `hint`. */
  | 'E_UNKNOWN_IDENTIFIER'
  /** A ref into a sibling subflow's child. */
  | 'E_OUT_OF_SCOPE'
  /** `vars.x` names no declared variable. */
  | 'E_UNKNOWN_VARIABLE'
  | 'E_DUPLICATE_VARIABLE'
  /** `env.X` where X does not match `PATTERNS.ENV_VAR_NAME` (constants.ts:431). */
  | 'E_INVALID_ENV_NAME'
  /** `p.<prop>` not in the loop/parallel KNOWN_PROPERTIES (loop.ts:44, parallel.ts:45). */
  | 'E_UNKNOWN_LOOP_PROPERTY'
  /** A ref to a block declared later; it resolves, but the order is unusual. */
  | 'W_FORWARD_REF'

/** Wiring (s3 §4 "Edges", build-spec decision 5). */
export type CompileEdgeCode =
  /** Reuses `getWorkflowEdgeScopeDropReason` (workflow.ts:595). */
  | 'E_EDGE_SCOPE'
  /** An edge to or from a note block. */
  | 'E_EDGE_NOTE'
  | 'E_TARGET_TRIGGER'
  /** `.to()` called directly on a condition or router. */
  | 'E_NO_DEFAULT_OUTPUT'
  | 'E_DUPLICATE_EDGE'
  | 'E_ERROR_PORT_UNSUPPORTED'
  /** `x.key.to()` where `key` is not a branch of `x`. */
  | 'E_UNKNOWN_BRANCH'
  | 'E_DUPLICATE_BRANCH_KEY'
  /** A branch key equal to an output name, `to` or `onError`. */
  | 'E_BRANCH_KEY_COLLIDES'
  /** A condition with two or more rows does not end with `else`. */
  | 'E_BRANCH_ELSE_LAST'
  /** `edge(a, 'raw', b)`: an unknown handle kept verbatim. */
  | 'W_RAW_HANDLE'

/** Checks against the block catalog (s3 §4 "Catalog checks", build-spec decision 2). */
export type CompileCatalogCode =
  | 'E_UNKNOWN_BUILDER'
  /** A new block of a catalog type marked `addable: false`; existing blocks keep compiling. */
  | 'E_TYPE_NOT_ADDABLE'
  /** `hint` carries a did-you-mean over the params visible for the chosen operation. */
  | 'E_UNKNOWN_PARAM'
  /** The builder already pins this param (`operation` or a `fixed` entry). */
  | 'E_FIXED_PARAM'
  /** `meta.modes` contradicts the mode the value kind implies. */
  | 'E_MODE_CONFLICT'
  /**
   * A param not visible under the block's current values. A warning, not an error, because stale
   * hidden values are preserved (build-spec decision 2); s3 called it `E_FIELD_NOT_APPLICABLE`.
   */
  | 'W_FIELD_NOT_APPLICABLE'
  /** A key under `meta.inactive` that is in fact active. */
  | 'W_INACTIVE_IS_ACTIVE'
  /** Includes `todo()` placeholders. */
  | 'W_REQUIRED_MISSING'
  /** The value's JSON type differs from the field's `valueKind`; never coerced. */
  | 'W_VALUE_KIND'
  /** Skipped when the block's outputs are dynamic. */
  | 'W_UNKNOWN_OUTPUT_PATH'

/** Function-code files (build-spec decision 9, s3 D6/D7). */
export type CodeFileCode =
  /** `fn('./x.js')` names a file absent from `CompileInput.files`. */
  | 'E_CODE_FILE_MISSING'
  /** Not a relative path inside the repo, or the extension does not match the block language. */
  | 'E_CODE_FILE_PATH'
  /** The printer's bijection self-check failed; the code was printed inline as `js```. */
  | 'W_CODE_FILE_INLINED'

/** References and comments, shared by compile and print (build-spec decision 8, s3 §4). */
export type ReferenceCode =
  /** A `<x.y>` token that resolves to nothing; kept as literal text. */
  | 'W_UNRESOLVED_REF'
  /** A ref that would point forward (a ref cycle), printed as literal text (s3 D10). */
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

/** Print emits only reference, comment and code-file fallbacks; every print compiles (s3 D12). */
export type PrintDiagnosticCode = ReferenceCode | 'W_CODE_FILE_INLINED' | 'W_RAW_HANDLE'

/** `parseWorkflowLock` (lock.ts). */
export type LockDiagnosticCode =
  /** The lock text is not valid JSON. */
  | 'E_LOCK_JSON'
  /** `lockVersion` is missing or not `1`. */
  | 'E_LOCK_VERSION'
  /** A required field is missing or has the wrong type or format. */
  | 'E_LOCK_SHAPE'
  /** A field the schema does not define (typos are caught, not ignored). */
  | 'E_LOCK_UNKNOWN_FIELD'
  /** A block or variable key that is not in normalized form. */
  | 'E_LOCK_KEY'
  /** A `binding` that is not a JS identifier, or is in `SDK_RESERVED_IDENTIFIERS`. */
  | 'E_LOCK_BINDING'
  | 'E_LOCK_DUPLICATE_BINDING'
  /** The same block, variable or branch id under two keys (s1 §4 "Stale lock"). */
  | 'E_LOCK_DUPLICATE_ID'
  /** A `parent` naming no lock block, itself, or forming a cycle. */
  | 'E_LOCK_PARENT'
  /** A branch key that is not a JS identifier. */
  | 'E_LOCK_BRANCH'
  /** A `codeFile` that is absolute, escapes the repo, or uses backslashes. */
  | 'E_LOCK_CODE_FILE_PATH'

/** canonicalize (s1 §2 algorithm, §5 quirks). */
export type CanonicalizeDiagnosticCode =
  /** Two stored names normalize to one key; the loser is keyed `key~n` (s1 step 1). */
  | 'E_CANON_LEGACY_NAME_COLLISION'
  /** A stored edge crosses subflow scopes (s1 quirk 20, workflow.ts:594-622). */
  | 'E_CANON_EDGE_SCOPE'
  /** A stored block name normalizes to a reserved prefix (`loop`, `parallel`, `variable`). */
  | 'W_CANON_RESERVED_NAME'
  /** An edge whose source or target block does not exist; dropped. */
  | 'W_CANON_DANGLING_EDGE'
  /** An unknown edge handle, kept as a `raw` port. */
  | 'W_CANON_RAW_HANDLE'
  /** A block type absent from the catalog; params kept, nothing marked inactive. */
  | 'W_CANON_UNKNOWN_BLOCK_TYPE'
  /** An internal id the resolver could not map to a key (`UnresolvedNode`). */
  | 'W_CANON_UNRESOLVED_ID'
  /** A stored branch title that disagrees with its positional title (s1 quirk 4). */
  | 'W_CANON_TITLE_OVERRIDE'
  /** A loop/parallel config the loader would repair (count 0, type fallback; s1 quirk 19). */
  | 'W_CANON_SUBFLOW_REPAIRED'
  /** Stored `subBlock.type` differs from the catalog's, or map key ≠ `subBlock.id` (s1 quirk 29). */
  | 'W_CANON_SUBBLOCK_TYPE_DRIFT'
  /** A stored JSON-string field that does not parse; kept as a native string. */
  | 'W_CANON_UNDECODABLE_JSON'

/** materialize and identity resolution (s1 §4). */
export type MaterializeDiagnosticCode =
  /** Two lock keys carry the same block id. */
  | 'E_MAT_DUPLICATE_LOCK_ID'
  /** A resource key the resolver cannot map to an id in this workspace. */
  | 'E_MAT_UNKNOWN_RESOURCE'
  /** A lock entry whose id has left prev; the block is re-created (s1 §4 "Stale lock"). */
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
 * `invalid_edge_target`, as `E_APPLY_<UPPER_SNAKE>`; the rest are s4 §2 additions. The engine
 * skips such an item silently, while source apply refuses the whole write (s4 D1, D5).
 */
export type ApplyDiagnosticCode =
  /** The base fingerprint no longer matches the stored graph (HTTP 409; s4 D3). */
  | 'E_APPLY_STALE'
  /** The diff touches a locked block or a child of a locked container (s4 D2). */
  | 'E_APPLY_PROTECTED_BLOCK'
  /** `validateWorkflowState` rejected the materialized graph. */
  | 'E_APPLY_INVALID_STATE'
  | 'E_APPLY_BLOCK_NOT_FOUND'
  | 'E_APPLY_INVALID_BLOCK_TYPE'
  | 'E_APPLY_BLOCK_NOT_ALLOWED'
  | 'E_APPLY_MODEL_NOT_ALLOWED'
  | 'E_APPLY_BLOCK_LOCKED'
  | 'E_APPLY_TOOL_NOT_ALLOWED'
  | 'E_APPLY_INVALID_EDGE_SOURCE'
  | 'E_APPLY_INVALID_EDGE_SCOPE'
  | 'E_APPLY_INVALID_SOURCE_HANDLE'
  | 'E_APPLY_INVALID_TARGET_HANDLE'
  | 'E_APPLY_INVALID_SUBBLOCK_FIELD'
  | 'E_APPLY_MISSING_REQUIRED_PARAMS'
  | 'E_APPLY_INVALID_SUBFLOW_PARENT'
  | 'E_APPLY_NESTED_SUBFLOW_NOT_ALLOWED'
  | 'E_APPLY_DUPLICATE_BLOCK_NAME'
  | 'E_APPLY_RESERVED_BLOCK_NAME'
  | 'E_APPLY_RETRY_NOT_SUPPORTED'
  | 'E_APPLY_DUPLICATE_TRIGGER'
  | 'E_APPLY_DUPLICATE_SINGLE_INSTANCE_BLOCK'
  | 'E_APPLY_DISABLED_ANCESTOR'
  /** A credential the acting user cannot reach. */
  | 'E_APPLY_CREDENTIAL_UNREACHABLE'
  /** The sandbox selection needs a plan the workspace does not have. */
  | 'E_APPLY_SANDBOX_PLAN_REQUIRED'
  /** A hosted key that does not apply to the acting user was dropped. */
  | 'W_APPLY_HOSTED_KEY_DROPPED'
  /** Value validation rewrote a value; the response files are re-printed. */
  | 'W_APPLY_VALUE_NORMALIZED'
  /** A block whose type is `legacy` or `deprecated`. */
  | 'W_APPLY_SUNSET_BLOCK'
  /** A block's type changed; its id, webhook URL and schedules are replaced. */
  | 'W_APPLY_TYPE_CHANGED'
  /** Connections to blocks that did not survive the gates were dropped. */
  | 'W_APPLY_PENDING_CONNECTIONS_DROPPED'
  /** A blocking workflow lint finding, mapped to a source line. */
  | 'E_APPLY_LINT'
  /** A non-blocking workflow lint finding, mapped to a source line. */
  | 'W_APPLY_LINT'

export type DiagnosticCode =
  | CompileDiagnosticCode
  | LockDiagnosticCode
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
