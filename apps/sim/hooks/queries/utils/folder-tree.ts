import type { WorkflowFolder } from '@/stores/folders/types'

/**
 * Returns true when the folder or one of its ancestors is locked. Used to
 * mirror server-side cascading folder lock policy on the client without an
 * extra round-trip.
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
  if (!folderId) return null

  const segments: string[] = []
  const visited = new Set<string>()
  let currentFolderId: string | null | undefined = folderId

  while (currentFolderId) {
    if (visited.has(currentFolderId)) break
    visited.add(currentFolderId)
    const folder: WorkflowFolder | undefined = folders[currentFolderId]
    if (!folder) break
    segments.unshift(folder.name)
    currentFolderId = folder.parentId
  }

  return segments.length > 0 ? segments.join(separator) : null
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
 * the server's `getWorkflowLockStatus(workflowId)` (in `@sim/workflow-authz`)
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
 * server's `getFolderLockStatus(folderId)` (in `@sim/workflow-authz`) but
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
