/**
 * Utility functions for generating names for workspaces and folders
 */

import type { Workspace } from '@/lib/organization/types'
import type { WorkflowFolder } from '@/stores/folders/store'

export interface NameableEntity {
  name: string
}

interface WorkspacesApiResponse {
  workspaces: Workspace[]
}

interface FoldersApiResponse {
  folders: WorkflowFolder[]
}

/**
 * Generates the next incremental name for entities following pattern: "{prefix} {number}"
 *
 * @param existingEntities - Array of entities with name property
 * @param prefix - Prefix for the name (e.g., "Workspace", "Folder", "Subfolder")
 * @returns Next available name (e.g., "Workspace 3")
 */
export function generateIncrementalName<T extends NameableEntity>(
  existingEntities: T[],
  prefix: string
): string {
  // Create regex pattern for the prefix (e.g., /^Workspace (\d+)$/)
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`)

  // Extract numbers from existing entities that match the pattern
  const existingNumbers = existingEntities
    .map((entity) => entity.name.match(pattern))
    .filter((match) => match !== null)
    .map((match) => Number.parseInt(match![1], 10))

  // Find next available number (highest + 1, or 1 if none exist)
  const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1

  return `${prefix} ${nextNumber}`
}

/**
 * Generates the next workspace name
 */
export async function generateWorkspaceName(): Promise<string> {
  const response = await fetch('/api/workspaces')
  const data = (await response.json()) as WorkspacesApiResponse
  const workspaces = data.workspaces || []

  return generateIncrementalName(workspaces, 'Workspace')
}

/**
 * Generates the next folder name for a workspace
 */
export async function generateFolderName(workspaceId: string): Promise<string> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
  const data = (await response.json()) as FoldersApiResponse
  const folders = data.folders || []

  // Filter to only root-level folders (parentId is null)
  const rootFolders = folders.filter((folder) => folder.parentId === null)

  return generateIncrementalName(rootFolders, 'Folder')
}

/**
 * Generates the next subfolder name for a parent folder
 */
export async function generateSubfolderName(
  workspaceId: string,
  parentFolderId: string
): Promise<string> {
  const response = await fetch(`/api/folders?workspaceId=${workspaceId}`)
  const data = (await response.json()) as FoldersApiResponse
  const folders = data.folders || []

  // Filter to only subfolders of the specified parent
  const subfolders = folders.filter((folder) => folder.parentId === parentFolderId)

  return generateIncrementalName(subfolders, 'Subfolder')
}
