import type { Json } from '@sim/workflow-code'
import type { WorkspaceDiagnostic } from './diagnostics'

/**
 * Every kind a workspace source directory can declare, in the order an apply writes them: a
 * resource exists before anything that references it (a workflow names tables, tools and skills).
 * Deletes run in the reverse order.
 */
export const APPLY_ORDER = [
  'custom-tool',
  'skill',
  'table',
  'knowledge-base',
  'file',
  'workflow',
] as const

/** A resource kind a workspace source directory can declare. */
export type WorkspaceKind = (typeof APPLY_ORDER)[number]

/** The top-level folder each kind lives in; a kind is managed only when its folder exists. */
export const KIND_DIRS = {
  'custom-tool': 'tools',
  skill: 'skills',
  table: 'tables',
  'knowledge-base': 'knowledge',
  file: 'files',
  workflow: 'workflows',
} as const satisfies Record<WorkspaceKind, string>

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
 * Reads and writes one kind's files. Pure: no I/O, no ids. Methods (not function properties) so a
 * registry of codecs with different declaration types type-checks.
 */
export interface KindCodec<D> {
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
  /**
   * The name a resource's base entry records one of its blobs under; a kind without it records
   * each blob under its workspace path.
   */
  baseBlobName?(key: string, path: string): string
  /** The blob path a base entry's blob `name` stands for: the inverse of `baseBlobName`. */
  baseBlobPath?(key: string, name: string): string
  /**
   * Whether `path`, one of the kind's, holds bytes rather than text: a blob travels by hash, and
   * its content only in the rounds the server asks for it. A kind without it holds only text.
   */
  isBlob?(path: string): boolean
  /**
   * What a key names: a resource key (the default), which the workspace's key table binds to the
   * resource and a workflow names it by; or `path`, the resource's own path (a workspace file),
   * which no key table records.
   */
  readonly keys?: 'resource' | 'path'
  /**
   * The byte limit the kind's text counts against: `declaration` (the default,
   * `maxDeclarationBytes`) or `workflow` (`maxWorkflowBytes`, with `maxWorkflows`).
   */
  readonly budget?: 'declaration' | 'workflow'
  /**
   * Whether a declaration was sent without its files, unchanged since the CLI last wrote them, so
   * nothing evaluates it (see `unchangedFiles` of the workflow kind). A kind without it always
   * sends its files.
   */
  isUnchanged?(decl: D): boolean
}
