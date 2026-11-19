import type { Json } from '@sim/workflow-code'
import type { WorkspaceDiagnostic } from './diagnostics'

/**
 * Every kind a workspace source directory can declare, in the order an apply writes them: a
 * resource exists before anything that references it (a workflow names secrets, credentials,
 * tables, tools, skills and MCP servers). Deletes run in the reverse order. A kind a workflow names
 * by key is spelled as that resource kind (`WORKSPACE_KIND_SPECS[kind].resourceKind`), so resource
 * keys and source agree on one name. Deployments come last: one publishes a workflow as the apply
 * left it.
 */
export const APPLY_ORDER = [
  'secret',
  'credential',
  'custom-tool',
  'skill',
  'mcp-server',
  'table',
  'knowledge-base',
  'file',
  'workflow',
  'deployment',
] as const

/** A resource kind a workspace source directory can declare. */
export type WorkspaceKind = (typeof APPLY_ORDER)[number]

/**
 * Where each kind lives: a top-level folder, or for a kind one root file declares whole
 * ({@link FILE_KINDS}), that file. A kind is managed only when its folder or file exists.
 */
export const KIND_DIRS = {
  secret: 'secrets.ts',
  credential: 'credentials.ts',
  'custom-tool': 'tools',
  skill: 'skills',
  'mcp-server': 'mcp',
  table: 'tables',
  'knowledge-base': 'knowledge',
  file: 'files',
  workflow: 'workflows',
  deployment: 'deployments',
} as const satisfies Record<WorkspaceKind, string>

/**
 * The kinds one root file declares whole (`secrets.ts`), each entry of it one resource: the file
 * is the kind's only path, so it has no folder or folder marker.
 */
const FILE_KINDS = ['secret', 'credential'] as const satisfies readonly WorkspaceKind[]

/** A kind one root file declares whole. */
export type FileKind = (typeof FILE_KINDS)[number]

/** Whether `kind` is declared by one root file rather than a folder. */
export function isFileKind(kind: WorkspaceKind): kind is FileKind {
  return FILE_KINDS.some((fileKind) => fileKind === kind)
}

/** Whether `value` names a kind, as `--only` and the API's `kinds` spell it. */
export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return Object.hasOwn(KIND_DIRS, value)
}

/** A binary file of the directory, by content hash: the bytes travel apart from the text files. */
export interface BlobEntry {
  /** Workspace-relative path. */
  path: string
  /** Lowercase hex SHA-256 of the bytes. */
  sha256: string
  size: number
}

/** A lowercase hex SHA-256, as a blob entry and a base record one. */
export const SHA256_HEX = /^[0-9a-f]{64}$/

/** Whether a blob entry carries a SHA-256 and a byte size (its content is checked elsewhere). */
export function isWellFormedBlob(blob: Pick<BlobEntry, 'sha256' | 'size'>): boolean {
  return SHA256_HEX.test(blob.sha256) && Number.isSafeInteger(blob.size) && blob.size >= 0
}

/** The paths of one kind, grouped by the resource key that owns them. */
export interface GroupedPaths {
  groups: Map<string, string[]>
  diagnostics: WorkspaceDiagnostic[]
}

/** What a resource's files read as: its declaration, or the findings that refuse it. */
interface ParsedDeclaration<D> {
  decl?: D
  diagnostics: WorkspaceDiagnostic[]
}

/** A declaration printed back to files, as `parse` reads them. */
export interface PrintedDeclaration {
  /** Workspace-relative path → text. */
  text: Record<string, string>
  blobs: BlobEntry[]
}

/**
 * Where one kind's files live and how they travel, apart from what they declare: grouping paths
 * into resources, which paths are blobs, what a key names and which budget the text counts
 * against. Catalog-independent, so the CLI and the plan read every kind's layout without the
 * server's column-type catalog a table codec needs. Methods (not function properties) so a
 * registry of layouts and codecs type-checks.
 */
export interface KindLayout {
  /** Groups the kind's paths by resource key; a path no resource owns is `E_DECL_UNKNOWN_FILE`. */
  group(paths: readonly string[]): GroupedPaths
  /**
   * The name a resource's base entry records one of its blobs under; a kind without it records
   * each blob under its workspace path.
   */
  baseBlobName?(key: string, path: string): string
  /** The blob path a base entry's blob `name` stands for: the inverse of `baseBlobName`. */
  baseBlobPath?(key: string, name: string): string
  /**
   * Whether `path`, one of the kind's, holds bytes rather than text: an apply names a blob by its
   * hash and stages its bytes apart. A kind without it holds only text.
   */
  isBlob?(path: string): boolean
  /**
   * The byte limit the kind's text counts against: `declaration` (the default,
   * `maxDeclarationBytes`) or `workflow` (`maxWorkflowBytes`, with `maxWorkflows`).
   */
  readonly budget?: Exclude<SourceBudget, 'rows'>
  /** The budget one of the kind's paths counts against, when it differs from {@link budget}. */
  budgetOf?(path: string): SourceBudget
}

/**
 * The byte limits a directory's text counts against: declarations (`maxDeclarationBytes`),
 * workflow files (`maxWorkflowBytes`) and table rows (`maxRowsBytes`).
 */
export type SourceBudget = 'declaration' | 'workflow' | 'rows'

/** The budget `path`, one of `layout`'s, counts against. */
export function budgetOfPath(layout: KindLayout, path: string): SourceBudget {
  return layout.budgetOf?.(path) ?? layout.budget ?? 'declaration'
}

/**
 * Reads and writes one kind's files: its {@link KindLayout} plus what the files declare. Pure: no
 * I/O, no ids.
 */
export interface KindCodec<D> extends KindLayout {
  /** Reads one resource's text files (workspace-relative path → text) and blobs. */
  parse(
    key: string,
    text: Readonly<Record<string, string>>,
    blobs: readonly BlobEntry[]
  ): ParsedDeclaration<D>
  print(key: string, decl: D): PrintedDeclaration
  /** Id-free canonical JSON; sha256 of it is the resource fingerprint `rf1:…`. */
  canonical(decl: D): Json
  /**
   * Whether a declaration was sent without its files, unchanged since the CLI last wrote them, so
   * nothing evaluates it (see `unchangedFiles` of the workflow kind). A kind without it always
   * sends its files.
   */
  isUnchanged?(decl: D): boolean
}
