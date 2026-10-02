'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listOrganizationProjectsContract,
  listProjectsContract,
  renameProjectContract,
} from '@/lib/api/contracts/projects'
import { projectKeys } from '@/hooks/queries/utils/project-keys'

/** Projects change when workspaces are created, forked or disconnected, which invalidate this. */
export const PROJECT_LIST_STALE_TIME = 60 * 1000

/** The projects the viewer can access, optionally within one organization. */
export function useProjectsQuery(organizationId?: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(organizationId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listProjectsContract, {
        query: organizationId ? { organizationId } : {},
        signal,
      })
      return data.projects
    },
    enabled,
    staleTime: PROJECT_LIST_STALE_TIME,
  })
}

export function useRenameProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { projectId: string; name: string }) =>
      requestJson(renameProjectContract, {
        params: { id: vars.projectId },
        body: { name: vars.name },
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
    },
  })
}

/** Full organization inventory for settings; the server requires organization admin authority. */
export function useOrganizationProjectsQuery(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: projectKeys.organizationList(organizationId),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listOrganizationProjectsContract, {
        params: { id: organizationId },
        signal,
      })
      return data.projects
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: PROJECT_LIST_STALE_TIME,
  })
}
