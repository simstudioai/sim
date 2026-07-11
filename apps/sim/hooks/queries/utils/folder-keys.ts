import type { FolderResourceType } from '@/lib/api/contracts/folders'

export type FolderQueryScope = 'active' | 'archived'

export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  workspaceLists: (workspaceId: string | undefined) =>
    [...folderKeys.lists(), workspaceId ?? ''] as const,
  workspaceResourceLists: (
    workspaceId: string | undefined,
    resourceType: FolderResourceType = 'workflow'
  ) => [...folderKeys.workspaceLists(workspaceId), resourceType] as const,
  list: (
    workspaceId: string | undefined,
    resourceType: FolderResourceType = 'workflow',
    scope: FolderQueryScope = 'active'
  ) => [...folderKeys.workspaceResourceLists(workspaceId, resourceType), scope] as const,
}
