import { buildFolderPath } from '@/lib/folders/paths'
import { folderAncestorChain } from '@/lib/folders/tree'
import type { WorkflowFolder } from '@/stores/folders/types'

/**
 * Returns true when the folder or one of its ancestors is locked. Used to
 * mirror server-side cascading folder lock policy on the client without an
 * extra round-trip.
 *
 * Walks inline rather than through {@link folderAncestorChain} on purpose: this runs per row
 * on every sidebar render, and stopping at the first locked ancestor beats materializing the
 * whole chain to scan it. Same for {@link findLockedAncestorFolder} below.
 */
export function isFolderOrAncestorLocked(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>
): boolean {
  const visited = new Set<string>()
  let currentFolderId = folderId ?? null

  while (currentFolderId) {
    if (visited.has(currentFolderId)) return false
    visited.add(currentFolderId)

    const folder = folders[currentFolderId]
    if (!folder) return false
    if (folder.locked) return true

    currentFolderId = folder.parentId
  }

  return false
}

/**
 * Returns the human-readable path for a folder, e.g. `'Engineering / Backend'`.
 * Returns `null` when the folder is at workspace root or unknown. Cycles or
 * missing ancestors short-circuit by returning the segments resolved so far.
 */
export function getFolderPath(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>,
  separator = ' / '
): string | null {
  const segments = folderAncestorChain(folderId, (id) => folders[id]).map((folder) => folder.name)
  return segments.length > 0 ? segments.join(separator) : null
}

/** Returns the canonical public API path for a folder and rejects corrupt trees. */
export function getCanonicalFolderPath(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder> | Map<string, WorkflowFolder>
): string {
  if (!folderId) return '/'

  const segments: string[] = []
  const visited = new Set<string>()
  let currentFolderId: string | null | undefined = folderId

  while (currentFolderId) {
    if (visited.has(currentFolderId)) throw new Error('Folder tree contains a cycle')
    visited.add(currentFolderId)

    const folder: WorkflowFolder | undefined =
      folders instanceof Map ? folders.get(currentFolderId) : folders[currentFolderId]
    if (!folder) throw new Error(`Folder ${currentFolderId} was not found`)
    segments.unshift(folder.name)
    currentFolderId = folder.parentId
  }

  return buildFolderPath(segments)
}

/**
 * Names that appear more than once in the list, so callers can disambiguate
 * only the entries that actually collide.
 */
export function collectDuplicateNames(names: Iterable<string>): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name)
    else seen.add(name)
  }
  return duplicates
}

/**
 * Appends the folder path to a name that another item in the same list shares,
 * e.g. `Leads (Sales / EMEA)` — or `Leads (Root)` at the workspace root. Names
 * that are already unique are returned untouched so the common case stays
 * readable.
 */
export function disambiguateLabelByFolder(
  name: string,
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>,
  duplicateNames: Set<string>
): string {
  if (!duplicateNames.has(name)) return name
  const folderPath = getFolderPath(folderId, folders)
  return folderPath ? `${name} (${folderPath})` : `${name} (Root)`
}

/**
 * Returns the closest locked ancestor folder for the given folderId, or `null`
 * when neither the folder nor any of its ancestors are locked. Cycles or
 * missing ancestors short-circuit and return `null` rather than looping.
 */
export function findLockedAncestorFolder(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>
): WorkflowFolder | null {
  if (!folderId) return null

  const visited = new Set<string>()
  let currentFolderId: string | null | undefined = folderId

  while (currentFolderId) {
    if (visited.has(currentFolderId)) return null
    visited.add(currentFolderId)
    const folder: WorkflowFolder | undefined = folders[currentFolderId]
    if (!folder) return null
    if (folder.locked) return folder
    currentFolderId = folder.parentId
  }

  return null
}

/**
 * Effective lock state for a workflow as visible to the client. Mirrors
 * the server's `getWorkflowLockStatus(workflowId)` (in `@sim/platform-authz/workflow`)
 * but reads from cached folder data instead of issuing DB walks. Treats an
 * undefined workflow as unlocked so callers don't need to early-return.
 */
export function isWorkflowEffectivelyLocked(
  workflow: { locked?: boolean | null; folderId?: string | null } | null | undefined,
  folders: Record<string, WorkflowFolder>
): boolean {
  if (!workflow) return false
  if (workflow.locked) return true
  return isFolderOrAncestorLocked(workflow.folderId, folders)
}

/**
 * Effective lock state for a folder as visible to the client. Mirrors the
 * server's `getFolderLockStatus(folderId)` (in `@sim/platform-authz/workflow`) but
 * reads from cached folder data instead of issuing DB walks. Treats an
 * undefined folder as unlocked so callers don't need to early-return.
 */
export function isFolderEffectivelyLocked(
  folder: { locked?: boolean | null; parentId?: string | null } | null | undefined,
  folders: Record<string, WorkflowFolder>
): boolean {
  if (!folder) return false
  if (folder.locked) return true
  return isFolderOrAncestorLocked(folder.parentId, folders)
}
