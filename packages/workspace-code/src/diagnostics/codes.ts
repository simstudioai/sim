/**
 * Every diagnostic code workspace source can emit beside the workflow pipeline's own (which keep
 * their codes, with files prefixed `workflows/<key>/`). The CLI and tests match on them, so they
 * freeze at release. The first letter fixes the severity, as in `@sim/workflow-code`.
 */

import type { DiagnosticCode } from '@sim/workflow-code'

/** Declaration files and the directory layout. */
const DECLARATION_CODES = [
  /** A Babel parse error, re-coded. */
  'E_DECL_SYNTAX',
  /** The first line is not `// @sim-sdk 1`. */
  'E_DECL_HEADER',
  /** An import from anything but `@sim/workflow-sdk/workspace`, or a non-named import. */
  'E_DECL_IMPORT',
  /** Not exactly one `export default defineX({ … })` with the kind's `defineX`. */
  'E_DECL_EXPORT',
  /** A construct outside the declaration grammar: JSON literals, the kind's helper calls. */
  'E_DECL_UNSUPPORTED',
  /** An object key declared twice. */
  'E_DECL_DUPLICATE_KEY',
  /** A required field is missing, or a field has the wrong type. */
  'E_DECL_SHAPE',
  /** A field the kind does not define. */
  'E_DECL_UNKNOWN_FIELD',
  /** A path inside a kind's folder that no resource owns. */
  'E_DECL_UNKNOWN_FILE',
  /**
   * A binary file sent with bytes that do not match the hash or size the directory declared, or
   * listed twice or at a path that holds no binary file: the apply writes nothing.
   */
  'E_BLOB_CONTENT',
  /**
   * A binary file a write needs whose bytes are not staged (or were staged at another size): the
   * apply writes nothing. Stage it, then apply again.
   */
  'E_BLOB_MISSING',
  /** A size, count or nesting limit exceeded (a file, a kind, the staging area, findings). */
  'E_LIMIT_EXCEEDED',
  /** A resource key outside `^[a-z][a-z0-9_-]{0,63}$`. */
  'E_KEY_INVALID',
  /**
   * A resource name, a skill name, a workspace file path or a knowledge document name holds a
   * bidi control or zero-width character, so it reads differently from what it stores. The
   * workflow-file counterpart is `W_SUSPICIOUS_CHARACTER`.
   */
  'W_DECL_SUSPICIOUS_CHARACTER',
] as const

/** `.sim/base.json`. */
const BASE_CODES = [
  'E_BASE_JSON',
  'E_BASE_VERSION',
  'E_BASE_SHAPE',
  'E_BASE_UNKNOWN_FIELD',
] as const

/** Secrets (`secrets.ts`). */
const SECRET_CODES = [
  /** A declared name outside the secret name format. */
  'E_SECRET_NAME',
  /** A workflow uses a declared secret the workspace holds no value for: it is held back. */
  'E_SECRET_MISSING',
  /** A declared secret the workspace holds no value for. */
  'W_SECRET_MISSING',
] as const

/** Credentials (`credentials.ts`). */
const CREDENTIAL_CODES = [
  /** A workflow uses a declared key no credential of its provider binds to: it is held back. */
  'E_CREDENTIAL_MISSING',
  /** A workflow uses a declared key several credentials could bind to: it is held back. */
  'E_CREDENTIAL_AMBIGUOUS',
  /** A declared key no credential of its provider binds to. */
  'W_CREDENTIAL_MISSING',
  /** A declared key several credentials could bind to. */
  'W_CREDENTIAL_AMBIGUOUS',
] as const

/** Tables. */
const TABLE_CODES = [
  /** A column key or name outside the table name pattern. */
  'E_TABLE_COLUMN_NAME',
  /** Two columns resolve to one name. */
  'E_TABLE_DUPLICATE_COLUMN',
  /** More columns than a table may hold: a size limit, classed like `E_LIMIT_EXCEEDED`. */
  'E_TABLE_TOO_MANY_COLUMNS',
  /** A select column without options, an option declared twice, or options on another type. */
  'E_TABLE_OPTIONS',
  /** A type change the stored cells cannot convert to. */
  'E_TABLE_TYPE_CONVERSION',
  /** A table folder that does not exist in the workspace. */
  'E_TABLE_FOLDER',
  /**
   * The declaration's `rows` or its `tables/<key>.rows.jsonl`: a bad mode or key column, a line
   * that is not a row of declared columns, a managed row without its key or repeating one.
   */
  'E_TABLE_ROWS',
  /** Seed rows declared for a table that already holds rows: only a new or empty table is seeded. */
  'I_TABLE_SEED_SKIPPED',
  /** A column dropped and one of the same type added: probably a rename, which loses the cells. */
  'W_LIKELY_RENAME',
] as const

/** Custom tools. */
const TOOL_CODES = [
  /** The schema is not a function declaration a custom tool may store. */
  'E_TOOL_SCHEMA',
  /**
   * `code` is not `codeFile('./<key>.js')`, a string or `stored()`, or its code file is missing or does not
   * parse.
   */
  'E_TOOL_CODE',
  /** `code: stored()` for a tool the server holds no code of (none stored under the key or title). */
  'E_TOOL_STORED_MISSING',
  /**
   * The code holds what looks like a literal credential (`holdsSecret`, as for function code): a
   * get prints it as `stored()`, and code a directory writes with one applies with this warning.
   */
  'W_TOOL_LITERAL_SECRET',
] as const

/** Skills. */
const SKILL_CODES = [
  /** `skills/<key>.md` does not open with a frontmatter block of `name` and `description`. */
  'E_SKILL_FRONTMATTER',
] as const

/** MCP servers. */
const MCP_CODES = [
  /** A credential header (`Authorization`, `X-Api-Key`, …) holds literal text, not an env reference. */
  'E_MCP_LITERAL_SECRET',
  /** `stored()` names a header the stored server holds no value for. */
  'E_MCP_STORED_MISSING',
  /** A workflow names a tool the MCP server does not list. */
  'E_MCP_TOOL_UNKNOWN',
  /** A changed URL replaces the server: a new server id, the old one deleted. */
  'W_MCP_REPLACE',
  /** The server's tools could not be listed, so the tool names workflows use are not checked. */
  'W_MCP_TOOLS_UNCHECKED',
] as const

/** Workspace files. */
const FILE_CODES = [
  /** A path no workspace file may have: a dot or empty segment, a reserved name or character. */
  'E_FILE_PATH',
  /** Two paths that differ only in letter case, or a path that is both a file and a folder. */
  'E_FILE_PATH_COLLISION',
  /** A name the server would store differently (trimmed, whitespace collapsed, NFC). */
  'E_FILE_NAME',
  /** A file over the per-blob cap: a get skips it and an apply never writes it. */
  'E_FILE_TOO_LARGE',
  /** A workspace file sent as text, or listed without a valid SHA-256 and size. */
  'E_FILE_CONTENT',
] as const

/** Knowledge bases. */
const KNOWLEDGE_CODES = [
  /** A declared embedding model that differs from the stored one: it is fixed at creation. */
  'E_KB_EMBEDDING_IMMUTABLE',
  /** A new knowledge base declares a model this server does not create knowledge bases with. */
  'E_KB_EMBEDDING_MODEL',
  /** The server holds several documents under one declared file name. */
  'E_KB_DOC_AMBIGUOUS',
  /** A document file name or type the knowledge base cannot hold. */
  'E_KB_DOC_NAME',
  /** An empty document, which a knowledge base cannot index. */
  'E_KB_DOC_EMPTY',
  /** Chunking settings outside what a knowledge base accepts. */
  'E_KB_CHUNKING',
  /** A knowledge base folder that does not exist in the workspace. */
  'E_KB_FOLDER',
  /** A stored document whose bytes this request had no budget left to download and compare. */
  'W_KB_DOC_UNCHECKED',
  /** Documents whose indexing failed: search does not find them until they are indexed again. */
  'W_KB_DOC_FAILED',
  /** How many documents the apply indexes (embeds) after it writes them. */
  'I_KB_REEMBED',
  /** Changed chunking applies to documents indexed from now on; stored ones keep their chunks. */
  'I_KB_CHUNKING',
  /** Documents still waiting to be indexed or being indexed: search finds them once that ends. */
  'I_KB_PROCESSING',
  /** Documents a get lists without a hash: it had no budget left to download them. */
  'I_KB_DOCS_UNHASHED',
  /** Documents source leaves alone: connector-synced, too large, or not a plain file name. */
  'I_KB_UNMANAGED_DOCS',
] as const

/** Deployments. */
const DEPLOYMENT_CODES = [
  /** `deployments/<key>.ts` names no workflow this workspace holds or this directory declares. */
  'E_DEPLOY_WORKFLOW',
  /**
   * A chat password written as a value instead of `env.NAME`, an unset variable, or `stored()`
   * where no password is stored.
   */
  'E_DEPLOY_SECRET',
  /** A chat output names a block the workflow does not have. */
  'E_DEPLOY_CHAT_OUTPUT',
  /** A chat change on a pinned deployment whose draft differs: deploying a chat publishes it. */
  'E_DEPLOY_PINNED_CHAT',
  /** An apply edits a deployed workflow that no `live: 'draft'` deployment republishes. */
  'W_DEPLOYED_DRAFT_CHANGED',
  /** A pinned deployment's draft differs from its live version, which keeps running. */
  'I_DEPLOY_DRAFT_NOT_LIVE',
] as const

/** Plan and apply. */
const PLAN_CODES = [
  /** The resource changed on the server since the directory was read (HTTP 409). */
  'E_APPLY_STALE',
  /** The server holds the resource but the directory has no base for it: get it first. */
  'E_APPLY_NO_BASE',
  /** The caller may not make this change. */
  'E_APPLY_FORBIDDEN',
  /** The change deletes a resource or data and `--allow-delete` was not given. */
  'E_APPLY_DELETE_NOT_ALLOWED',
  /** The resource is locked against this change (HTTP 423). */
  'E_APPLY_LOCKED',
  /** A change a child operation refused, with its message. */
  'E_APPLY_REFUSED',
  /** A write failed for a reason that is not the source's (logged on the server). */
  'E_APPLY_FAILED',
  /** The apply would make more changes or touch more workflows than one request may. */
  'E_PLAN_TOO_LARGE',
  /** A declared resource references one this apply deletes. */
  'E_PLAN_REF_DELETED',
  /** A declared resource references one this apply holds back, so it is held back too. */
  'E_PLAN_REF_HELD',
  /** A resource this apply deletes is still used by stored workflows. */
  'W_RESOURCE_IN_USE',
  /** Another resource of the kind holds this name or key. */
  'E_NAME_TAKEN',
  /** A workflow folder sent without its files whose base names no workflow of this workspace. */
  'E_WORKFLOW_FILES_MISSING',
  /** A workflow folder holding the base of another declared folder's workflow: a copy. */
  'E_WORKFLOW_FOLDER_COPIED',
  /**
   * A resource the server holds that the directory does not declare (kept without
   * `--allow-delete`).
   */
  'W_UNDECLARED',
  /** The directory's base was read from another workspace: every resource is created anew. */
  'W_BASE_OTHER_WORKSPACE',
  /** The server changed a resource the directory leaves as it was; the next get shows it. */
  'I_SERVER_CHANGED',
  /** The server deleted a resource the directory leaves as it was; it is not created again. */
  'I_SERVER_DELETED',
  /** The server moved a resource the directory leaves as it was; it is not created again. */
  'I_SERVER_MOVED',
  /** A key bound to a deleted resource was bound to the one this apply wrote. */
  'I_KEY_REBOUND',
  /** A declaration under a new key for a resource the base read under another: keys never move. */
  'E_KEY_RENAMED',
  /** The plan had more findings than one answer reports; this one counts those left out. */
  'I_FINDINGS_TRUNCATED',
] as const

/** Every code a workspace source finding can carry, as a value: the wire contracts' enum. */
export const WORKSPACE_DIAGNOSTIC_CODES = [
  ...DECLARATION_CODES,
  ...BASE_CODES,
  ...SECRET_CODES,
  ...CREDENTIAL_CODES,
  ...TABLE_CODES,
  ...TOOL_CODES,
  ...SKILL_CODES,
  ...MCP_CODES,
  ...FILE_CODES,
  ...KNOWLEDGE_CODES,
  ...DEPLOYMENT_CODES,
  ...PLAN_CODES,
] as const
export type WorkspaceDiagnosticCode = (typeof WORKSPACE_DIAGNOSTIC_CODES)[number]

/** How a finding weighs: an error refuses, a warning and an info only report. */
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

/** How a refused apply is classed: its HTTP status on the server, its exit code in the CLI. */
export type RefusalClass = 'conflict' | 'locked' | 'payload_too_large' | 'validation'

/**
 * The class of a refusal with these error codes, the most specific first: a resource changed
 * since the directory was read (`conflict`), then a locked one, then a size limit, else
 * `validation`.
 */
export function refusalClass(
  codes: Iterable<WorkspaceDiagnosticCode | DiagnosticCode>
): RefusalClass {
  const present = new Set<WorkspaceDiagnosticCode | DiagnosticCode>(codes)
  if (present.has('E_APPLY_STALE')) return 'conflict'
  if (present.has('E_APPLY_LOCKED')) return 'locked'
  if (
    present.has('E_LIMIT_EXCEEDED') ||
    present.has('E_PLAN_TOO_LARGE') ||
    present.has('E_FILE_TOO_LARGE') ||
    present.has('E_TABLE_TOO_MANY_COLUMNS')
  ) {
    return 'payload_too_large'
  }
  return 'validation'
}
