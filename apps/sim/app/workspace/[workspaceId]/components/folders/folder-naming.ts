import type { WorkflowFolder } from '@/stores/folders/types'

const DEFAULT_FOLDER_NAME = 'New folder'

/**
 * First `"New folder"` / `"New folder (N)"` name not already taken by an active sibling
 * under `parentId`.
 *
 * The `folder` table has a partial unique index on active
 * `(workspaceId, resourceType, parentId, name)`, and a create the user did not name has no
 * way to recover from a 409 — so a "New folder" button dedups up front rather than surfacing
 * a conflict. Deliberately matches the `" (N)"` shape of `deduplicateFolderName` on the
 * server so a deduped name reads the same however it was produced. A concurrent create can
 * still win the race; the caller must handle the 409 that follows.
 */
export function nextUntitledFolderName(folders: WorkflowFolder[], parentId: string | null): string {
  const siblingNames = new Set(
    folders.filter((folder) => (folder.parentId ?? null) === parentId).map((folder) => folder.name)
  )

  if (!siblingNames.has(DEFAULT_FOLDER_NAME)) return DEFAULT_FOLDER_NAME

  let suffix = 1
  while (siblingNames.has(`${DEFAULT_FOLDER_NAME} (${suffix})`)) suffix += 1
  return `${DEFAULT_FOLDER_NAME} (${suffix})`
}
