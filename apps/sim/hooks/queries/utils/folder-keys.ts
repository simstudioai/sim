export type FolderQueryScope = 'active' | 'archived'

export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, scope: FolderQueryScope = 'active') =>
    [...folderKeys.lists(), workspaceId ?? '', scope] as const,
}
