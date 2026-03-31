export const folderKeys = {
  all: ['folders'] as const,
  lists: () => [...folderKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...folderKeys.lists(), workspaceId ?? ''] as const,
}
