import type { FolderApi, FolderResourceType } from '@/lib/api/contracts/folders'
import type { WorkflowFolder } from '@/stores/folders/types'

export type FolderQueryScope = 'active' | 'archived'

export const FOLDER_LIST_STALE_TIME = 60 * 1000

/**
 * Maps a wire folder row to the client `WorkflowFolder` shape (string dates → `Date`).
 *
 * Lives beside the keys rather than in the hooks module so a server prefetch can hydrate a
 * folder list without importing `@/hooks/queries/folders`, which drags the contracts barrel and
 * the optimistic-mutation machinery in with it. Fields are listed explicitly, not spread, so a
 * new wire field cannot silently enter the cached shape and diverge a hydrated entry from a
 * client fetch.
 */
export function mapFolder(folder: FolderApi): WorkflowFolder {
  return {
    id: folder.id,
    name: folder.name,
    userId: folder.userId,
    workspaceId: folder.workspaceId,
    parentId: folder.parentId,
    resourceType: folder.resourceType,
    locked: folder.locked,
    sortOrder: folder.sortOrder,
    createdAt: new Date(folder.createdAt),
    updatedAt: new Date(folder.updatedAt),
    deletedAt: folder.deletedAt ? new Date(folder.deletedAt) : null,
  }
}

/**
 * `resourceType` is part of the key, not an implicit default, because one workspace holds
 * an independent folder tree per resource. Without it the Knowledge, Tables, and Workflows
 * folder lists would share a single cache entry and overwrite each other.
 *
 * Typed against the full `FolderResourceType` rather than the narrower set the API serves,
 * so a cached row's own `resourceType` can be used to address its list without a cast.
 */
export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  resource: (resourceType: FolderResourceType = 'workflow') =>
    [...folderKeys.lists(), resourceType] as const,
  list: (
    workspaceId: string | undefined,
    scope: FolderQueryScope = 'active',
    resourceType: FolderResourceType = 'workflow'
  ) => [...folderKeys.resource(resourceType), workspaceId ?? '', scope] as const,
}
