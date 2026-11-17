/**
 * Every diagnostic code workspace source can emit beside the workflow pipeline's own (which keep
 * their codes, with files prefixed `workflows/<key>/`). The CLI and tests match on them, so they
 * freeze at release. The first letter fixes the severity, as in `@sim/workflow-code`.
 */

/** Declaration files and the directory layout. */
type DeclarationCode =
  /** A Babel parse error, re-coded. */
  | 'E_DECL_SYNTAX'
  /** The first line is not `// @sim-sdk 1`. */
  | 'E_DECL_HEADER'
  /** An import from anything but `@sim/workflow-sdk/workspace`, or a non-named import. */
  | 'E_DECL_IMPORT'
  /** Not exactly one `export default defineX({ … })` with the kind's `defineX`. */
  | 'E_DECL_EXPORT'
  /** A construct outside the declaration grammar: JSON literals, the kind's helper calls. */
  | 'E_DECL_UNSUPPORTED'
  /** An object key declared twice. */
  | 'E_DECL_DUPLICATE_KEY'
  /** A required field is missing, or a field has the wrong type. */
  | 'E_DECL_SHAPE'
  /** A field the kind does not define. */
  | 'E_DECL_UNKNOWN_FIELD'
  /** A path inside a kind's folder that no resource owns. */
  | 'E_DECL_UNKNOWN_FILE'
  /** A file larger than its limit, or nesting deeper than the cap. */
  | 'E_LIMIT_EXCEEDED'
  /** A resource key outside `^[a-z][a-z0-9_-]{0,63}$`. */
  | 'E_KEY_INVALID'
  /** A kind whose declarations this server cannot read or write yet. */
  | 'E_KIND_UNSUPPORTED'

/** `.sim/base.json`. */
type BaseCode = 'E_BASE_JSON' | 'E_BASE_VERSION' | 'E_BASE_SHAPE' | 'E_BASE_UNKNOWN_FIELD'

/** Tables. */
type TableCode =
  /** A column key or name outside the table name pattern. */
  | 'E_TABLE_COLUMN_NAME'
  /** Two columns resolve to one name. */
  | 'E_TABLE_DUPLICATE_COLUMN'
  /** More columns than a table may hold. */
  | 'E_TABLE_TOO_MANY_COLUMNS'
  /** A select column without options, an option declared twice, or options on another type. */
  | 'E_TABLE_OPTIONS'
  /** A type change the stored cells cannot convert to. */
  | 'E_TABLE_TYPE_CONVERSION'
  /** A table folder that does not exist in the workspace. */
  | 'E_TABLE_FOLDER'
  /** A column dropped and one of the same type added: probably a rename, which loses the cells. */
  | 'W_LIKELY_RENAME'
  /** Workflow-group output columns are managed by their group and left alone. */
  | 'I_TABLE_WORKFLOW_COLUMNS'

/** Custom tools. */
type ToolCode =
  /** The schema is not a function declaration a custom tool may store. */
  | 'E_TOOL_SCHEMA'
  /** `code` is not `codeFile('./<key>.js')` or a string, or its code file is missing or does not parse. */
  | 'E_TOOL_CODE'
  /** A tool this apply deletes is still used by stored workflows, which lose it. */
  | 'W_TOOL_IN_USE'

/** Skills. */
type SkillCode =
  /** `skills/<key>.md` does not open with a frontmatter block of `name` and `description`. */
  'E_SKILL_FRONTMATTER'

/** Plan and apply. */
type PlanCode =
  /** The resource changed on the server since the directory was read (HTTP 409). */
  | 'E_APPLY_STALE'
  /** The server holds the resource but the directory has no base for it: get it first. */
  | 'E_APPLY_NO_BASE'
  /** The caller may not make this change; nothing was written. */
  | 'E_APPLY_FORBIDDEN'
  /** The change deletes a resource or data and `--allow-delete` was not given. */
  | 'E_APPLY_DELETE_NOT_ALLOWED'
  /** The resource is locked against this change (HTTP 423). */
  | 'E_APPLY_LOCKED'
  /** A change a child operation refused while planning, with its message. */
  | 'E_APPLY_REFUSED'
  /** A write failed for a reason that is not the source's (logged on the server). */
  | 'E_APPLY_FAILED'
  /** The apply would make more changes or touch more workflows than one request may. */
  | 'E_PLAN_TOO_LARGE'
  /** A declared resource references one this apply deletes. */
  | 'E_PLAN_REF_DELETED'
  /** Another resource of the kind holds this name or key. */
  | 'E_NAME_TAKEN'
  /** A workflow directory sent without its files whose workflow no longer exists. */
  | 'E_WORKFLOW_FILES_MISSING'
  /** A resource the server holds that the directory does not declare (kept without `--allow-delete`). */
  | 'W_UNDECLARED'
  /** The server changed a resource the directory leaves as it was; the next get shows it. */
  | 'I_SERVER_CHANGED'
  /** A key bound to a deleted resource was bound to its replacement. */
  | 'I_KEY_REBOUND'

export type WorkspaceDiagnosticCode =
  | DeclarationCode
  | BaseCode
  | TableCode
  | ToolCode
  | SkillCode
  | PlanCode

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** The severity a code's prefix fixes. */
export type SeverityOfCode<C extends string> = C extends `E_${string}`
  ? 'error'
  : C extends `W_${string}`
    ? 'warning'
    : 'info'

/** The severity of any code, by its prefix. */
export function severityOf(code: string): DiagnosticSeverity {
  return code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info'
}
