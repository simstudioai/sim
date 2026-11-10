import type { WorkspaceQueryScope } from '@/lib/api/contracts/workspaces'

/**
 * Query key factory for workspace-related queries.
 * Provides hierarchical cache keys for workspaces, settings, and permissions.
 */
export const workspaceKeys = {
  all: ['workspace'] as const,
  lists: () => [...workspaceKeys.all, 'list'] as const,
  /**
   * The viewer's list as the server answers it for one organization: the list read sends the
   * shell's organization, so lists read in different organizations never share an entry.
   */
  organizationLists: (organizationId: string | undefined) =>
    [...workspaceKeys.lists(), 'user', organizationId ?? ''] as const,
  list: (scope: WorkspaceQueryScope = 'active', organizationId?: string) =>
    [...workspaceKeys.organizationLists(organizationId), scope] as const,
  details: () => [...workspaceKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  settings: (id: string) => [...workspaceKeys.detail(id), 'settings'] as const,
  permissions: (id: string) => [...workspaceKeys.detail(id), 'permissions'] as const,
  members: (id: string) => [...workspaceKeys.detail(id), 'members'] as const,
  adminLists: () => [...workspaceKeys.all, 'adminList'] as const,
  /** `listOrganizationId` is the organization the list read sends; `organizationId` narrows it. */
  adminList: (
    userId: string | undefined,
    listOrganizationId: string | undefined,
    organizationId: string | undefined
  ) =>
    [
      ...workspaceKeys.adminLists(),
      userId ?? '',
      listOrganizationId ?? '',
      organizationId ?? '',
    ] as const,
}
