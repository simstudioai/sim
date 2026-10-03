import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { readWorkspaceDashboardContract } from '@/lib/api/contracts/dashboards'

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
