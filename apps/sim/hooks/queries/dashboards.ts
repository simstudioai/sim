import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateDashboardBody,
  createDashboardContract,
  createDashboardFolderContract,
  deleteDashboardContract,
  deleteDashboardFolderContract,
  listDashboardFoldersContract,
  listDashboardsContract,
  type MoveDashboardBody,
  moveDashboardContract,
  moveDashboardFolderContract,
  readDashboardContract,
  type UpdateDashboardBody,
  updateDashboardContract,
} from '@/lib/api/contracts/dashboards'
import { workspaceFilesKeys } from '@/hooks/queries/workspace-files'

export const DASHBOARD_STALE_TIME = 30_000
export const dashboardKeys = {
  all: ['dashboards'] as const,
  lists: () => [...dashboardKeys.all, 'list'] as const,
  list: (workspaceId: string, search = '') =>
    [...dashboardKeys.lists(), workspaceId, search] as const,
  details: () => [...dashboardKeys.all, 'detail'] as const,
  detail: (workspaceId: string, id: string) =>
    [...dashboardKeys.details(), workspaceId, id] as const,
  folders: (workspaceId: string) => [...dashboardKeys.all, 'folders', workspaceId] as const,
}
export function useDashboards(workspaceId: string, search = '', options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dashboardKeys.list(workspaceId, search),
    queryFn: ({ signal }) =>
      requestJson(listDashboardsContract, {
        params: { id: workspaceId },
        query: { search },
        signal,
      }),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: DASHBOARD_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
export function useDashboard(workspaceId: string, dashboardId: string) {
  return useQuery({
    queryKey: dashboardKeys.detail(workspaceId, dashboardId),
    queryFn: ({ signal }) =>
      requestJson(readDashboardContract, { params: { id: workspaceId, dashboardId }, signal }),
    enabled: Boolean(workspaceId && dashboardId),
    staleTime: DASHBOARD_STALE_TIME,
  })
}
export function useDashboardFolders(workspaceId: string) {
  return useQuery({
    queryKey: dashboardKeys.folders(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listDashboardFoldersContract, { params: { id: workspaceId }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: DASHBOARD_STALE_TIME,
  })
}
type DashboardMutation =
  | { operation: 'create'; body: CreateDashboardBody }
  | { operation: 'update'; dashboardId: string; body: UpdateDashboardBody }
  | { operation: 'move'; dashboardId: string; body: MoveDashboardBody }
  | { operation: 'delete'; dashboardId: string }
  | { operation: 'createFolder' | 'deleteFolder'; path: string }
  | { operation: 'moveFolder'; path: string; destinationPath: string }

export function useDashboardMutation(workspaceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (input: DashboardMutation) => {
      switch (input.operation) {
        case 'create':
          return requestJson(createDashboardContract, {
            params: { id: workspaceId },
            body: input.body,
          })
        case 'update':
          return requestJson(updateDashboardContract, {
            params: { id: workspaceId, dashboardId: input.dashboardId },
            body: input.body,
          })
        case 'move':
          return requestJson(moveDashboardContract, {
            params: { id: workspaceId, dashboardId: input.dashboardId },
            body: input.body,
          })
        case 'delete':
          return requestJson(deleteDashboardContract, {
            params: { id: workspaceId, dashboardId: input.dashboardId },
          })
        case 'createFolder':
          return requestJson(createDashboardFolderContract, {
            params: { id: workspaceId },
            body: { path: input.path },
          })
        case 'deleteFolder':
          return requestJson(deleteDashboardFolderContract, {
            params: { id: workspaceId },
            body: { path: input.path },
          })
        case 'moveFolder':
          return requestJson(moveDashboardFolderContract, {
            params: { id: workspaceId },
            body: { path: input.path, destinationPath: input.destinationPath },
          })
      }
    },
    onSuccess: (_data, input) => {
      void client.invalidateQueries({ queryKey: dashboardKeys.lists() })
      void client.invalidateQueries({ queryKey: dashboardKeys.folders(workspaceId) })
      void client.invalidateQueries({ queryKey: workspaceFilesKeys.lists() })
      if ('dashboardId' in input)
        void client.invalidateQueries({
          queryKey: dashboardKeys.detail(workspaceId, input.dashboardId),
        })
    },
  })
}
