import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createSandboxContract,
  deleteSandboxContract,
  listSandboxesContract,
  type Sandbox,
  type SandboxListResponse,
  updateSandboxContract,
} from '@/lib/api/contracts'

const logger = createLogger('SandboxQueries')

export type { Sandbox, SandboxListResponse }

export const sandboxKeys = {
  all: ['sandboxes'] as const,
  lists: () => [...sandboxKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...sandboxKeys.lists(), workspaceId ?? ''] as const,
}

export const SANDBOX_LIST_STALE_TIME = 30 * 1000

/** Poll cadence while any sandbox is still building; see {@link useSandboxes}. */
export const SANDBOX_BUILD_POLL_INTERVAL = 3 * 1000

/**
 * Bounds the build poll. A worker killed mid-build leaves a row `building` until
 * the next save re-claims it, and without this a tab left open on that sandbox
 * would poll forever. Covers a little over the 15-minute build cap.
 */
const MAX_BUILD_POLLS = 350

async function fetchSandboxes(
  workspaceId: string,
  signal?: AbortSignal
): Promise<SandboxListResponse> {
  return requestJson(listSandboxesContract, { params: { id: workspaceId }, signal })
}

/** True while at least one sandbox has a build that has not reached a terminal state. */
export function hasPendingBuild(sandboxes: readonly Sandbox[]): boolean {
  return sandboxes.some(
    (sandbox) => sandbox.buildStatus === 'pending' || sandbox.buildStatus === 'building'
  )
}

/**
 * Query options shared by the hook and the Function block's sandbox picker
 * (`fetchWorkspaceSandboxOptions`), so both read one cache entry rather than two.
 */
export function getSandboxListQueryOptions(workspaceId: string) {
  return {
    queryKey: sandboxKeys.list(workspaceId),
    queryFn: ({ signal }: { signal?: AbortSignal }) => fetchSandboxes(workspaceId, signal),
    staleTime: SANDBOX_LIST_STALE_TIME,
  }
}

export function useSandboxes(workspaceId?: string) {
  return useQuery({
    queryKey: sandboxKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchSandboxes(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: SANDBOX_LIST_STALE_TIME,
    // Builds are the only thing that changes without a user action, so the poll
    // runs only while one is in flight and stops on the first terminal read.
    refetchInterval: (query) =>
      query.state.data &&
      hasPendingBuild(query.state.data.sandboxes) &&
      query.state.dataUpdateCount < MAX_BUILD_POLLS
        ? SANDBOX_BUILD_POLL_INTERVAL
        : false,
  })
}

type CreateSandboxParams = {
  workspaceId: string
} & ContractBodyInput<typeof createSandboxContract>

export function useCreateSandbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...body }: CreateSandboxParams) => {
      const data = await requestJson(createSandboxContract, {
        params: { id: workspaceId },
        body,
      })
      logger.info(`Created sandbox ${body.name} in workspace ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.list(variables.workspaceId) }),
  })
}

type UpdateSandboxParams = {
  workspaceId: string
  sandboxId: string
} & ContractBodyInput<typeof updateSandboxContract>

export function useUpdateSandbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, sandboxId, ...body }: UpdateSandboxParams) => {
      const data = await requestJson(updateSandboxContract, {
        params: { id: workspaceId, sandboxId },
        body,
      })
      logger.info(`Updated sandbox ${sandboxId} in workspace ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.list(variables.workspaceId) }),
  })
}

export function useDeleteSandbox() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, sandboxId }: { workspaceId: string; sandboxId: string }) => {
      const data = await requestJson(deleteSandboxContract, {
        params: { id: workspaceId, sandboxId },
      })
      logger.info(`Deleted sandbox ${sandboxId} from workspace ${workspaceId}`)
      return data
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.list(variables.workspaceId) }),
  })
}
