export const customToolsKeys = {
  all: ['customTools'] as const,
  lists: () => [...customToolsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...customToolsKeys.lists(), workspaceId] as const,
  detail: (toolId: string) => [...customToolsKeys.all, 'detail', toolId] as const,
}
