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
      // Invalidate workspace settings
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}
