export const customToolsKeys = {
  all: ['customTools'] as const,
  lists: () => [...customToolsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...customToolsKeys.lists(), workspaceId] as const,
  details: () => [...customToolsKeys.all, 'detail'] as const,
  detail: (toolId: string) => [...customToolsKeys.details(), toolId] as const,
}
