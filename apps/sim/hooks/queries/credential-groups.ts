'use client'

import { useQuery } from '@tanstack/react-query'
import {
  credentialGroupKeys,
  fetchWorkspaceAccounts,
  WORKSPACE_ACCOUNTS_STALE_TIME,
} from '@/hooks/queries/utils/credential-group-queries'

export function useWorkspaceAccounts(workspaceId?: string) {
  return useQuery({
    queryKey: credentialGroupKeys.workspace(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID is required')
      return fetchWorkspaceAccounts(workspaceId, signal)
    },
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_ACCOUNTS_STALE_TIME,
  })
}
