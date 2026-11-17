/**
 * The workspace source directory's layout: where each kind lives and which paths a server answer
 * may name. The CLI writes only paths {@link isWorkspaceSourcePath} accepts, whatever base URL
 * answered.
 *
 * Client-safe: no parser imports.
 */
import { KIND_DIRS, type WorkspaceKind } from './kind'

/** Per-resource ids and fingerprints for one environment (`WorkspaceBaseV1`). */
export const WORKSPACE_BASE_FILE = '.sim/base.json'
/** Blobs a get left out for their size, so the directory says what it does not hold. */
export const WORKSPACE_SKIPPED_FILE = '.sim/skipped.json'
/** A workflow directory's lock and base, as `sim workflows source` keeps them. */
export const WORKFLOW_LOCK_FILE = '.sim/lock.json'
export const WORKFLOW_BASE_FILE = '.sim/base.json'
/** The entry file of a table declaration: `tables/<key>.ts`. */
export const DECLARATION_EXTENSION = '.ts'

/** The stored resource key format (`workspace_resource_key.key`), unanchored. */
export const RESOURCE_KEY_SOURCE = '[a-z][a-z0-9_-]{0,63}'

const RESOURCE_KEY_PATTERN = new RegExp(`^${RESOURCE_KEY_SOURCE}$`)

/** Whether `value` is a resource key: lowercase, starting with a letter, at most 64 characters. */
export function isResourceKey(value: string): boolean {
  return RESOURCE_KEY_PATTERN.test(value)
}

const KIND_BY_DIR = new Map<string, WorkspaceKind>(
  Object.entries(KIND_DIRS).map(([kind, dir]) => [dir, kind as WorkspaceKind])
)

/** The kind whose folder holds `path`, or `null` for a path outside every kind's folder. */
export function kindOfPath(path: string): WorkspaceKind | null {
  const slash = path.indexOf('/')
  return slash <= 0 ? null : (KIND_BY_DIR.get(path.slice(0, slash)) ?? null)
}

/** A character a file name never holds: controls, backslash, and the Windows reserved set. */
const UNSAFE_CHARACTER = /[\u0000-\u001f\u007f\\:*?"<>|]/

/** A workflow directory's own sidecars, the only dot-segment paths a server answer may name. */
const WORKFLOW_SIDECAR = /^workflows\/[^/]+\/\.sim\/(?:lock|base)\.json$/

/**
 * Whether a server answer may write `path` into the directory: inside a kind's folder, every
 * segment a plain name (no `.`/`..`, no leading dot but a workflow's `.sim/lock.json` and
 * `.sim/base.json`, no control or reserved character), so nothing lands in `.git`, a dotfile or
 * outside the directory.
 */
export function isWorkspaceSourcePath(path: string): boolean {
  if (kindOfPath(path) === null || UNSAFE_CHARACTER.test(path)) return false
  if (WORKFLOW_SIDECAR.test(path)) return true
  return path.split('/').every((segment) => segment.length > 0 && !segment.startsWith('.'))
}

/**
 * Whether `key` can address a workspace file: its path under `files/`, as
 * {@link isWorkspaceSourcePath} accepts it. A file's key is its path, not a resource key.
 */
export function isFileKey(key: string): boolean {
  return isWorkspaceSourcePath(`${KIND_DIRS.file}/${key}`)
}

/** A knowledge base document: `knowledge/<key>/docs/<file>`. */
const KNOWLEDGE_DOCUMENT = /^knowledge\/[^/]+\/docs\/[^/]+$/

/**
 * Whether `path` holds bytes rather than text: a workspace file or a knowledge document. Blobs
 * travel by hash and their content only in the rounds the server asks for it.
 */
export function isBlobPath(path: string): boolean {
  return kindOfPath(path) === 'file' || KNOWLEDGE_DOCUMENT.test(path)
}
