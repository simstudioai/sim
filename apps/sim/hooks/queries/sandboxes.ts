import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createSandboxContract,
  deleteSandboxContract,
  type Sandbox,
  type SandboxListResponse,
  updateSandboxContract,
} from '@/lib/api/contracts'
import { getSandboxListQueryOptions, sandboxKeys } from '@/hooks/queries/sandbox-list'

const logger = createLogger('SandboxQueries')

export type { Sandbox, SandboxListResponse }

/** Poll cadence while any sandbox is still building; see {@link useSandboxes}. */
export const SANDBOX_BUILD_POLL_INTERVAL = 3 * 1000

/**
 * Bounds the build poll. A worker killed mid-build leaves a row `building` until
 * the next save re-claims it, and without this a tab left open on that sandbox
 * would poll forever. Covers a little over the 15-minute build cap.
 */
const MAX_BUILD_POLLS = 350

/** True while at least one sandbox has a build that has not reached a terminal state. */
export function hasPendingBuild(sandboxes: readonly Sandbox[]): boolean {
  return sandboxes.some(
    (sandbox) => sandbox.buildStatus === 'pending' || sandbox.buildStatus === 'building'
  )
}

export function useSandboxes(workspaceId?: string) {
  return useQuery({
    ...getSandboxListQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
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
    onMutate: async ({ workspaceId, sandboxId }) => {
      const queryKey = sandboxKeys.list(workspaceId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<SandboxListResponse>(queryKey)
      if (previous) {
        queryClient.setQueryData<SandboxListResponse>(queryKey, {
          ...previous,
          sandboxes: previous.sandboxes.filter((sandbox) => sandbox.id !== sandboxId),
        })
      }
      return { previous }
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sandboxKeys.list(variables.workspaceId), context.previous)
      }
    },
    onSettled: (_data, _error, variables) =>
      queryClient.invalidateQueries({ queryKey: sandboxKeys.list(variables.workspaceId) }),
  })
}
