import { useRef } from 'react'
import {
  type QueryClient,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  configurePeopleSyncContract,
  disconnectPeopleSyncContract,
  getPeopleSyncContract,
  type PeopleSyncConfig,
  type PeopleSyncStatus,
  runPeopleSyncContract,
} from '@/lib/api/contracts/people-sync'
import { peopleKeys } from '@/hooks/queries/people'

const SYNC_STATUS_STALE_TIME = 5_000
const ACTIVE_SYNC_POLL_MS = 2_500
const IDLE_SYNC_POLL_MS = 30_000
const syncKeys = {
  all: ['people-directory-sync'] as const,
  organization: (organizationId: string) => [...syncKeys.all, organizationId] as const,
  actions: (organizationId: string) =>
    [...syncKeys.organization(organizationId), 'action'] as const,
}

type SyncResult = ContractJsonResponse<typeof getPeopleSyncContract>

export function isDirectorySyncAccessError(error: unknown) {
  return isApiClientError(error) && [401, 403, 404].includes(error.status)
}

function refreshPublishedPeople(client: QueryClient, organizationId: string, result: SyncResult) {
  const previous = client.getQueryData<SyncResult>(syncKeys.organization(organizationId))
  if ((previous?.sync?.lastSuccessAt ?? null) !== (result.sync?.lastSuccessAt ?? null)) {
    return client.invalidateQueries({ queryKey: peopleKeys.organization(organizationId) })
  }
}

export function usePeopleSyncStatus(organizationId: string, enabled = true) {
  const client = useQueryClient()
  return useQuery({
    enabled,
    queryKey: syncKeys.organization(organizationId),
    queryFn: async ({ signal }) => {
      const result = await requestJson(getPeopleSyncContract, {
        params: { id: organizationId },
        signal,
      })
      if (!signal.aborted) void refreshPublishedPeople(client, organizationId, result)
      return result
    },
    staleTime: SYNC_STATUS_STALE_TIME,
    refetchInterval: (query) => {
      const sync = query.state.data?.sync
      const error = query.state.error
      if (error) return isDirectorySyncAccessError(error) ? false : IDLE_SYNC_POLL_MS
      if (!sync) return false
      if (sync.retryAt) return IDLE_SYNC_POLL_MS
      return sync.state === 'syncing' || sync.state === 'queued'
        ? ACTIVE_SYNC_POLL_MS
        : IDLE_SYNC_POLL_MS
    },
  })
}

export function usePeopleSyncActions(organizationId: string) {
  const client = useQueryClient()
  // Only the action name may enter the mutation cache or its devtools.
  const nextConfig = useRef<PeopleSyncConfig | null>(null)
  const mutationKey = syncKeys.actions(organizationId)
  const pending = useIsMutating({ mutationKey }) > 0
  const mutation = useMutation({
    mutationKey,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
    mutationFn: (
      action: 'configure' | 'run' | 'disconnect'
    ): Promise<{ sync: PeopleSyncStatus | null }> => {
      const params = { id: organizationId }
      if (action === 'run') return requestJson(runPeopleSyncContract, { params })
      if (action === 'disconnect') return requestJson(disconnectPeopleSyncContract, { params })
      const body = nextConfig.current
      nextConfig.current = null
      if (!body) throw new Error('Choose a directory connection')
      return requestJson(configurePeopleSyncContract, { params, body })
    },
    onSuccess: async (result, action) => {
      const queryKey = syncKeys.organization(organizationId)
      await client.cancelQueries({ queryKey })
      // A sync can publish while the disconnect is in flight, so its last-success time can't say
      // whether the cached people still exist.
      const refreshed =
        action === 'disconnect'
          ? client.invalidateQueries({ queryKey: peopleKeys.organization(organizationId) })
          : refreshPublishedPeople(client, organizationId, result)
      client.setQueryData(queryKey, result)
      await refreshed
    },
    onError: () => client.invalidateQueries({ queryKey: syncKeys.organization(organizationId) }),
    onSettled: () => {
      nextConfig.current = null
    },
  })
  function submit(
    action: 'configure' | 'run' | 'disconnect',
    config?: PeopleSyncConfig,
    onSuccess?: () => void,
    onError?: (error: Error) => void
  ) {
    if (client.isMutating({ mutationKey }) > 0) return
    nextConfig.current = config ?? null
    mutation.mutate(action, { onSuccess: () => onSuccess?.(), onError })
  }
  return {
    configure: (config: PeopleSyncConfig, onSuccess: () => void) =>
      submit('configure', config, onSuccess),
    run: () => submit('run'),
    disconnect: (onSuccess: () => void, onError?: (error: Error) => void) =>
      submit('disconnect', undefined, onSuccess, onError),
    pending,
    action: mutation.isPending ? mutation.variables : null,
    error: mutation.error,
    reset: mutation.reset,
  }
}
