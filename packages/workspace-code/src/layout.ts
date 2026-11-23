/**
 * The workspace source directory's layout: where each kind lives and which paths a server answer
 * may name. The CLI writes only paths {@link isWorkspaceSourcePath} accepts, whatever base URL
 * answered.
 *
 * Client-safe: no parser imports.
 */
import { SOURCE_BASE_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { isFileKind, KIND_DIRS, type WorkspaceKind } from './kind'

/** Per-resource ids and fingerprints for one environment (`WorkspaceBaseV1`). */
export const WORKSPACE_BASE_FILE = '.sim/base.json'
/**
 * Resources a get left out (over a limit, or unreadable as source), so the directory says what it
 * does not hold.
 */
export const WORKSPACE_SKIPPED_FILE = '.sim/skipped.json'
/** The entry file of a table declaration: `tables/<key>.ts`. */
export const DECLARATION_EXTENSION = '.ts'

/** The stored resource key format (`workspace_resource_key.key`), unanchored. */
const RESOURCE_KEY_SOURCE = '[a-z][a-z0-9_-]{0,63}'

const RESOURCE_KEY_PATTERN = new RegExp(`^${RESOURCE_KEY_SOURCE}$`)

/** Whether `value` is a resource key: lowercase, starting with a letter, at most 64 characters. */
export function isResourceKey(value: string): boolean {
  return RESOURCE_KEY_PATTERN.test(value)
}

/** The stored secret name format (`v2SecretNameSchema` in apps/sim). */
const SECRET_NAME_PATTERN = /^[A-Za-z0-9_]{1,255}$/

/** Whether `value` is a secret name: letters, digits and `_`, at most 255 characters. */
export function isSecretName(value: string): boolean {
  return SECRET_NAME_PATTERN.test(value)
}

/** A root declaration file as a module specifier: its path without the extension. */
function moduleOf(file: string): string {
  return file.endsWith(DECLARATION_EXTENSION) ? file.slice(0, -DECLARATION_EXTENSION.length) : file
}

/**
 * Where the declarations the SDK's `workspace.d.ts` types live, from the directory root as module
 * specifiers: the tables folder, and the credentials and secrets files without their extension
 * (the SDK's `WorkspaceManifest.declarationModules`).
 */
export const DECLARATION_MODULES = {
  tables: KIND_DIRS.table,
  credentials: moduleOf(KIND_DIRS.credential),
  secrets: moduleOf(KIND_DIRS.secret),
} as const

/** The kind each top-level folder or root file holds. */
export const KIND_BY_DIR: ReadonlyMap<string, WorkspaceKind> = new Map<string, WorkspaceKind>(
  Object.entries(KIND_DIRS).map(([kind, dir]) => [dir, kind as WorkspaceKind])
)

/**
 * The kind whose folder holds `path`, or whose root file it is; `null` for a path outside every
 * kind's folder and file.
 */
export function kindOfPath(path: string): WorkspaceKind | null {
  const slash = path.indexOf('/')
  const kind = KIND_BY_DIR.get(slash === -1 ? path : path.slice(0, slash))
  if (kind === undefined) return null
  return (slash === -1) === isFileKind(kind) ? kind : null
}

/** A character a file name never holds: controls, backslash, and the Windows reserved set. */
const UNSAFE_CHARACTER = /[\u0000-\u001f\u007f\\:*?"<>|]/

/**
 * A workflow directory's own sidecars, the only dot-segment paths a server answer may name. The
 * folder is a resource key, so `workflows/../.sim/base.json` never passes as one.
 */
const WORKFLOW_SIDECAR = new RegExp(
  `^${KIND_DIRS.workflow}/${RESOURCE_KEY_SOURCE}/(?:${[SOURCE_LOCK_FILE, SOURCE_BASE_FILE]
    .map((file) => file.replaceAll('.', '\\.'))
    .join('|')})$`
)

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
