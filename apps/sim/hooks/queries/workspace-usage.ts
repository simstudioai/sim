import { type QueryClient, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkspaceCreditAvailabilityContract,
  getWorkspaceUsageGateContract,
  type WorkspaceCreditAvailability,
  type WorkspaceUsageGate,
} from '@/lib/api/contracts/workspaces'
import { subscriptionKeys } from '@/hooks/queries/subscription'

export const workspaceUsageKeys = {
  all: ['workspace-usage'] as const,
  creditAvailabilities: () => [...workspaceUsageKeys.all, 'credit-availability'] as const,
  creditAvailability: (workspaceId: string) =>
    [...workspaceUsageKeys.creditAvailabilities(), workspaceId] as const,
  gates: () => [...workspaceUsageKeys.all, 'gate'] as const,
  gate: (workspaceId: string) => [...workspaceUsageKeys.gates(), workspaceId] as const,
}

export const WORKSPACE_CREDIT_AVAILABILITY_STALE_TIME = 30 * 1000
export const WORKSPACE_USAGE_GATE_STALE_TIME = 30 * 1000

/**
 * Usage is written asynchronously as a run settles, so a refetch fired on completion
 * races the write and re-reads the old balance.
 */
const USAGE_SETTLE_DELAY_MS = 1000

/**
 * Invalidates the workspace credit/usage reads after anything that moves the balance —
 * a run that spends credits, a top-up, a plan change, or a usage-limit edit. Both
 * families are keyed per workspace but derive from the same billing account, so the
 * family prefixes (not a single workspace's key) are what has to be refetched.
 */
export function invalidateWorkspaceUsage(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.creditAvailabilities() }),
    queryClient.invalidateQueries({ queryKey: workspaceUsageKeys.gates() }),
  ])
}

export function fetchWorkspaceCreditAvailability(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceCreditAvailability> {
  return requestJson(getWorkspaceCreditAvailabilityContract, {
    params: { id: workspaceId },
    signal,
  })
}

export function fetchWorkspaceUsageGate(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceUsageGate> {
  return requestJson(getWorkspaceUsageGateContract, {
    params: { id: workspaceId },
    signal,
  })
}

export function useWorkspaceCreditAvailability(workspaceId?: string) {
  return useQuery({
    queryKey: workspaceUsageKeys.creditAvailability(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspaceCreditAvailability(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_CREDIT_AVAILABILITY_STALE_TIME,
  })
}

export function useWorkspaceUsageGate(workspaceId?: string) {
  return useQuery({
    queryKey: workspaceUsageKeys.gate(workspaceId ?? ''),
    queryFn: ({ signal }) => fetchWorkspaceUsageGate(workspaceId as string, signal),
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_USAGE_GATE_STALE_TIME,
  })
}

/**
 * Refreshes the billing reads a run touches, after a delay: usage is written
 * asynchronously as the run settles, so an immediate refetch races the write and
 * re-reads the pre-run balance.
 *
 * Shared by the surfaces that spend credits — workflow execution and wand
 * generation — so the delay and the key set stay in one place.
 */
export function scheduleUsageRefresh(queryClient: QueryClient) {
  setTimeout(() => {
    void queryClient.invalidateQueries({ queryKey: subscriptionKeys.users() })
    void invalidateWorkspaceUsage(queryClient)
  }, USAGE_SETTLE_DELAY_MS)
}
