import { useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  listPersonalCredentialsContract,
  type StartPersonalCredentialConnectionBody,
  startPersonalCredentialConnectionContract,
} from '@/lib/api/contracts/credentials'

export const PERSONAL_CREDENTIAL_STALE_TIME = 30_000

export const personalCredentialKeys = {
  all: ['personal-credentials'] as const,
  lists: () => [...personalCredentialKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...personalCredentialKeys.lists(), workspaceId ?? ''] as const,
}

export function usePersonalCredentials(
  workspaceId?: string,
  options?: { enabled?: boolean; refetchInterval?: number | false }
) {
  return useQuery({
    queryKey: personalCredentialKeys.list(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID is required')
      const result = await requestJson(listPersonalCredentialsContract, {
        query: { workspaceId },
        signal,
      })
      return result.credentials
    },
    enabled: Boolean(workspaceId) && options?.enabled !== false,
    staleTime: PERSONAL_CREDENTIAL_STALE_TIME,
    refetchInterval: options?.refetchInterval ?? false,
    retry: false,
  })
}

export function useStartPersonalCredentialConnection() {
  return useMutation({
    mutationFn: (body: StartPersonalCredentialConnectionBody) =>
      requestJson(startPersonalCredentialConnectionContract, { body }),
  })
}
