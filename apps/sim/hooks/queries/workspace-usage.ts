import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkspaceCreditAvailabilityContract,
  getWorkspaceUsageGateContract,
  type WorkspaceCreditAvailability,
  type WorkspaceUsageGate,
} from '@/lib/api/contracts/workspaces'

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
