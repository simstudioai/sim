/** Query keys for projects; shared by the project hooks and the workspace hooks that move workspaces between projects. */
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  organizationList: (organizationId: string) =>
    [...projectKeys.lists(), 'organization-admin', organizationId] as const,
  list: (organizationId: string | undefined) =>
    [...projectKeys.lists(), organizationId ?? ''] as const,
}
