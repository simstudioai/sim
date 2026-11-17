import type { Json } from '@sim/workflow-code'
import type { WorkspaceDiagnostic } from './diagnostics'

/** A resource kind a workspace source directory can declare. */
export type WorkspaceKind =
  | 'custom-tool'
  | 'skill'
  | 'table'
  | 'knowledge-base'
  | 'file'
  | 'workflow'

/**
 * The order an apply writes kinds in, so a resource exists before anything that references it
 * (a workflow names tables, tools and skills). Deletes run in the reverse order.
 */
export const APPLY_ORDER: readonly WorkspaceKind[] = [
  'custom-tool',
  'skill',
  'table',
  'knowledge-base',
  'file',
  'workflow',
]

/** The top-level folder each kind lives in; a kind is managed only when its folder exists. */
export const KIND_DIRS = {
  'custom-tool': 'tools',
  skill: 'skills',
  table: 'tables',
  'knowledge-base': 'knowledge',
  file: 'files',
  workflow: 'workflows',
} as const satisfies Record<WorkspaceKind, string>

export type KindDir = (typeof KIND_DIRS)[WorkspaceKind]

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

/** The paths of one kind, grouped by the resource key that owns them. */
export interface GroupedPaths {
  groups: Map<string, string[]>
  diagnostics: WorkspaceDiagnostic[]
}

/** What a resource's files read as: its declaration, or the findings that refuse it. */
export interface ParsedDeclaration<D> {
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
 * Reads and writes one kind's files. Pure: no I/O, no ids. Methods (not function properties) so a
 * registry of codecs with different declaration types type-checks.
 */
export interface KindCodec<D> {
  kind: WorkspaceKind
  dir: KindDir
  /** Groups the kind's paths by resource key; a path no resource owns is `E_DECL_UNKNOWN_FILE`. */
  group(paths: readonly string[]): GroupedPaths
  /** Reads one resource's text files (workspace-relative path → text) and blobs. */
  parse(
    key: string,
    text: Readonly<Record<string, string>>,
    blobs: readonly BlobEntry[]
  ): ParsedDeclaration<D>
  print(key: string, decl: D): PrintedDeclaration
  /** Id-free canonical JSON; sha256 of it is the resource fingerprint `rf1:…`. */
  canonical(decl: D): Json
  /** Keys this declaration references in other kinds (workflows → tables, …). */
  refs?(decl: D): Array<{ kind: WorkspaceKind; key: string }>
}
