export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (organizationId: string) => [...projectKeys.lists(), organizationId] as const,
  complete: (organizationId: string) =>
    [...projectKeys.lists(), 'complete', organizationId] as const,
  byWorkspace: (workspaceId: string) => [...projectKeys.all, 'by-workspace', workspaceId] as const,
}
