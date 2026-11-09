import type { WorkspaceQueryScope } from '@/lib/api/contracts/workspaces'

/**
 * Query key factory for workspace-related queries.
 * Provides hierarchical cache keys for workspaces, settings, and permissions.
 */
export const workspaceKeys = {
  all: ['workspace'] as const,
  lists: () => [...workspaceKeys.all, 'list'] as const,
  list: (scope: WorkspaceQueryScope = 'active') =>
    [...workspaceKeys.lists(), 'user', scope] as const,
  details: () => [...workspaceKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  settings: (id: string) => [...workspaceKeys.detail(id), 'settings'] as const,
  permissions: (id: string) => [...workspaceKeys.detail(id), 'permissions'] as const,
  members: (id: string) => [...workspaceKeys.detail(id), 'members'] as const,
  adminLists: () => [...workspaceKeys.all, 'adminList'] as const,
  adminList: (userId: string | undefined) => [...workspaceKeys.adminLists(), userId ?? ''] as const,
}
