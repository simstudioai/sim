import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * Query key factories for workspace-related queries
 */
export const workspaceKeys = {
  all: ['workspace'] as const,
  details: () => [...workspaceKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  settings: (id: string) => [...workspaceKeys.detail(id), 'settings'] as const,
  permissions: (id: string) => [...workspaceKeys.detail(id), 'permissions'] as const,
  adminLists: () => [...workspaceKeys.all, 'adminList'] as const,
  adminList: (userId: string | undefined) => [...workspaceKeys.adminLists(), userId ?? ''] as const,
}

/**
 * Fetch workspace settings
 */
async function fetchWorkspaceSettings(workspaceId: string) {
  const [settingsResponse, permissionsResponse] = await Promise.all([
    fetch(`/api/workspaces/${workspaceId}`),
    fetch(`/api/workspaces/${workspaceId}/permissions`),
  ])

  if (!settingsResponse.ok || !permissionsResponse.ok) {
    throw new Error('Failed to fetch workspace settings')
  }

  const [settings, permissions] = await Promise.all([
    settingsResponse.json(),
    permissionsResponse.json(),
  ])

  return {
    settings,
    permissions,
  }
}

/**
 * Hook to fetch workspace settings
 */
export function useWorkspaceSettings(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

/**
 * Update workspace settings mutation
 */
interface UpdateWorkspaceSettingsParams {
  workspaceId: string
  billedAccountUserId?: string
  billingAccountUserEmail?: string
}

export function useUpdateWorkspaceSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...updates }: UpdateWorkspaceSettingsParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update workspace settings')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}

/**
 * Workspace type returned by admin workspaces query
 */
export interface AdminWorkspace {
  id: string
  name: string
  isOwner: boolean
  ownerId?: string
  canInvite: boolean
}

/**
 * Fetch workspaces where user has admin access
 */
async function fetchAdminWorkspaces(userId: string | undefined): Promise<AdminWorkspace[]> {
  if (!userId) {
    return []
  }

  const workspacesResponse = await fetch('/api/workspaces')
  if (!workspacesResponse.ok) {
    throw new Error('Failed to fetch workspaces')
  }

  const workspacesData = await workspacesResponse.json()
  const allUserWorkspaces = workspacesData.workspaces || []

  const permissionPromises = allUserWorkspaces.map(
    async (workspace: { id: string; name: string; isOwner?: boolean; ownerId?: string }) => {
      try {
        const permissionResponse = await fetch(`/api/workspaces/${workspace.id}/permissions`)
        if (!permissionResponse.ok) {
          return null
        }
        const permissionData = await permissionResponse.json()
        return { workspace, permissionData }
      } catch (error) {
        return null
      }
    }
  )

  const results = await Promise.all(permissionPromises)

  const adminWorkspaces: AdminWorkspace[] = []
  for (const result of results) {
    if (!result) continue

    const { workspace, permissionData } = result
    let hasAdminAccess = false

    if (permissionData.users) {
      const currentUserPermission = permissionData.users.find(
        (user: { id: string; userId?: string; permissionType: string }) =>
          user.id === userId || user.userId === userId
      )
      hasAdminAccess = currentUserPermission?.permissionType === 'admin'
    }

    const isOwner = workspace.isOwner || workspace.ownerId === userId

    if (hasAdminAccess || isOwner) {
      adminWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        isOwner,
        ownerId: workspace.ownerId,
        canInvite: true,
      })
    }
  }

  return adminWorkspaces
}

/**
 * Hook to fetch workspaces where user has admin access
 */
export function useAdminWorkspaces(userId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.adminList(userId),
    queryFn: () => fetchAdminWorkspaces(userId),
    enabled: Boolean(userId),
    staleTime: 60 * 1000, // Cache for 60 seconds
    placeholderData: keepPreviousData,
  })
}
