import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
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
}

export function usePeopleSyncStatus(organizationId: string) {
  return useQuery({
    queryKey: syncKeys.organization(organizationId),
    queryFn: ({ signal }) =>
      requestJson(getPeopleSyncContract, { params: { id: organizationId }, signal }),
    staleTime: SYNC_STATUS_STALE_TIME,
    refetchInterval: (query) => {
      const sync = query.state.data?.sync
      const error = query.state.error
      if (error)
        return isApiClientError(error) && [401, 403, 404].includes(error.status)
          ? false
          : IDLE_SYNC_POLL_MS
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
  const busy = useRef(false)
  const mutation = useMutation({
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
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: syncKeys.organization(organizationId) }),
        client.invalidateQueries({ queryKey: peopleKeys.organization(organizationId) }),
      ]),
    onError: () => client.invalidateQueries({ queryKey: syncKeys.organization(organizationId) }),
    onSettled: () => {
      busy.current = false
      nextConfig.current = null
    },
  })
  function submit(
    action: 'configure' | 'run' | 'disconnect',
    config?: PeopleSyncConfig,
    onSuccess?: () => void
  ) {
    if (busy.current) return
    busy.current = true
    nextConfig.current = config ?? null
    mutation.mutate(action, { onSuccess })
  }
  return {
    configure: (config: PeopleSyncConfig, onSuccess: () => void) =>
      submit('configure', config, onSuccess),
    run: () => submit('run'),
    disconnect: (onSuccess: () => void) => submit('disconnect', undefined, onSuccess),
    pending: mutation.isPending,
    action: mutation.isPending ? mutation.variables : null,
    error: mutation.error,
    reset: mutation.reset,
  }
}
