import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  deleteWorkspaceDashboardContract,
  readWorkspaceDashboardContract,
} from '@/lib/api/contracts/dashboards'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const DASHBOARD_STALE_TIME = 30_000
export const dashboardKeys = {
  all: ['dashboards'] as const,
  workspace: (workspaceId: string) => [...dashboardKeys.all, workspaceId] as const,
}

/** The workspace's single dashboard; `dashboard` and `content` are null until the first save. */
export function useWorkspaceDashboard(workspaceId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dashboardKeys.workspace(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(readWorkspaceDashboardContract, { params: { id: workspaceId }, signal }),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: DASHBOARD_STALE_TIME,
  })
}

export function useDeleteWorkspaceDashboard(workspaceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () =>
      requestJson(deleteWorkspaceDashboardContract, { params: { id: workspaceId } }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: dashboardKeys.workspace(workspaceId) })
      void client.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
    },
  })
}
