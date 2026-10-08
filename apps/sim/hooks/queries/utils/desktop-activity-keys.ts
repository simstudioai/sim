export const desktopActivityKeys = {
  all: ['desktop-activity'] as const,
  lists: () => [...desktopActivityKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...desktopActivityKeys.lists(), workspaceId ?? ''] as const,
}
