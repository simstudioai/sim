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
  /**
   * A binary file sent with bytes that do not match the hash or size the directory declared, or
   * listed twice or at a path that holds no binary file: the apply writes nothing.
   */
  | 'E_BLOB_CONTENT'
  /** A file larger than its limit, or nesting deeper than the cap. */
  | 'E_LIMIT_EXCEEDED'
  /** A resource key outside `^[a-z][a-z0-9_-]{0,63}$`. */
  | 'E_KEY_INVALID'

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

/** Workspace files. */
type FileCode =
  /** A path no workspace file may have: a dot or empty segment, a reserved name or character. */
  | 'E_FILE_PATH'
  /** Two paths that differ only in letter case, or a path that is both a file and a folder. */
  | 'E_FILE_PATH_COLLISION'
  /** A name the server would store differently (trimmed, whitespace collapsed, NFC). */
  | 'E_FILE_NAME'
  /** A file over the per-blob cap: a get skips it and an apply never writes it. */
  | 'E_FILE_TOO_LARGE'
  /** A workspace file sent as text, or listed without a valid SHA-256 and size. */
  | 'E_FILE_CONTENT'

/** Knowledge bases. */
type KnowledgeCode =
  /** A declared embedding model that differs from the stored one: it is fixed at creation. */
  | 'E_KB_EMBEDDING_IMMUTABLE'
  /** A new knowledge base declares a model this server does not create knowledge bases with. */
  | 'E_KB_EMBEDDING_MODEL'
  /** The server holds several documents under one declared file name. */
  | 'E_KB_DOC_AMBIGUOUS'
  /** A document file name or type the knowledge base cannot hold. */
  | 'E_KB_DOC_NAME'
  /** An empty document, which a knowledge base cannot index. */
  | 'E_KB_DOC_EMPTY'
  /** Chunking settings outside what a knowledge base accepts. */
  | 'E_KB_CHUNKING'
  /** A knowledge base folder that does not exist in the workspace. */
  | 'E_KB_FOLDER'
  /** Replacing a document drops the tag values the stored one holds. */
  | 'W_KB_DOC_TAGS'
  /** A stored document whose bytes this request had no budget left to download and compare. */
  | 'W_KB_DOC_UNCHECKED'
  /** How many documents the apply indexes (embeds) after it writes them. */
  | 'I_KB_REEMBED'
  /** Changed chunking applies to documents indexed from now on; stored ones keep their chunks. */
  | 'I_KB_CHUNKING'
  /** Documents a get lists without a hash: it had no budget left to download them. */
  | 'I_KB_DOCS_UNHASHED'
  /** Documents source leaves alone: connector-synced, too large, or not a plain file name. */
  | 'I_KB_UNMANAGED_DOCS'

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
  /** A workflow folder sent without its files whose base names no workflow of this workspace. */
  | 'E_WORKFLOW_FILES_MISSING'
  /** A resource the server holds that the directory does not declare (kept without `--allow-delete`). */
  | 'W_UNDECLARED'
  /** The directory's base was read from another workspace: every resource is created anew. */
  | 'W_BASE_OTHER_WORKSPACE'
  /** The server changed a resource the directory leaves as it was; the next get shows it. */
  | 'I_SERVER_CHANGED'
  /** The server deleted a resource the directory leaves as it was; it is not created again. */
  | 'I_SERVER_DELETED'
  /** The server moved a resource the directory leaves as it was; it is not created again. */
  | 'I_SERVER_MOVED'
  /** A key bound to a deleted resource was bound to the one this apply wrote. */
  | 'I_KEY_REBOUND'

export type WorkspaceDiagnosticCode =
  | DeclarationCode
  | BaseCode
  | TableCode
  | ToolCode
  | SkillCode
  | FileCode
  | KnowledgeCode
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
