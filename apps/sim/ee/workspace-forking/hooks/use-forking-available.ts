import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getForkAvailabilityContract } from '@/lib/api/contracts/workspace-fork'

export const forkAvailabilityKeys = {
  all: ['fork-availability'] as const,
  details: () => [...forkAvailabilityKeys.all, 'detail'] as const,
  detail: (workspaceId?: string) => [...forkAvailabilityKeys.details(), workspaceId ?? ''] as const,
}

/** Availability flips only on plan changes or flag rollouts - cache generously. */
const FORK_AVAILABILITY_STALE_TIME = 5 * 60 * 1000

interface ForkingAvailability {
  available: boolean
  /** The lookup is still in flight - callers that gate a whole page wait on this. */
  isLoading: boolean
}

/**
 * Server-evaluated fork availability for the workspace: the verdict of the exact gate
 * every fork route enforces (env/plan + the `workspace-forking` AppConfig rollout
 * flag), served by the availability route. Used to hide the Forks settings tab and
 * the fork context-menu entries; the server gate remains the security boundary.
 */
export function useForkingAvailability(workspaceId?: string): ForkingAvailability {
  const { data, isLoading } = useQuery({
    queryKey: forkAvailabilityKeys.detail(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getForkAvailabilityContract, { params: { id: workspaceId as string }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: FORK_AVAILABILITY_STALE_TIME,
  })
  return { available: data?.available ?? false, isLoading }
}

/** Boolean shorthand for surfaces that only show/hide fork entry points. */
export function useForkingAvailable(workspaceId?: string): boolean {
  return useForkingAvailability(workspaceId).available
}
