import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getWorkspaceSettingsNavigationContract } from '@/lib/api/contracts/workspace-settings'

export const WORKSPACE_SETTINGS_ACCESS_STALE_TIME = 0
export const workspaceSettingsKeys = {
  all: ['workspace-settings-navigation'] as const,
  lists: () => [...workspaceSettingsKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...workspaceSettingsKeys.lists(), workspaceId] as const,
}
export function useWorkspaceSettingsNavigation(workspaceId: string) {
  return useQuery({
    queryKey: workspaceSettingsKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getWorkspaceSettingsNavigationContract, { params: { id: workspaceId }, signal }),
    staleTime: WORKSPACE_SETTINGS_ACCESS_STALE_TIME,
  })
}
