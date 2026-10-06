import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client'
import { computerUseAvailabilityContract } from '@/lib/api/contracts/computer-use'

const computerUseKeys = {
  all: ['computer-use'] as const,
  availability: () => [...computerUseKeys.all, 'availability'] as const,
}

const COMPUTER_USE_AVAILABILITY_STALE_TIME = 0

/** Resolve the rollout on the server; devices never infer feature access from their own preference. */
export function useComputerUseAvailability(enabled: boolean) {
  return useQuery({
    queryKey: computerUseKeys.availability(),
    queryFn: ({ signal }) => requestJson(computerUseAvailabilityContract, { signal }),
    enabled,
    staleTime: COMPUTER_USE_AVAILABILITY_STALE_TIME,
  })
}
