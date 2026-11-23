import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  organizationComputerUseAvailabilityContract,
  workspaceComputerUseAvailabilityContract,
} from '@/lib/api/contracts/computer-use'
import {
  PERMISSION_GROUPS_STALE_TIME,
  permissionGroupKeys,
} from '@/hooks/queries/utils/permission-group-keys'
import { shouldRetrySettingsRead } from '@/hooks/queries/utils/settings-read-retry'

/** The workspace or organization whose permission group governs computer use for its chats. */
export type ComputerUseOwner = { workspaceId: string } | { organizationId: string }

/**
 * Whether the owner's permission group allows computer use, asked of the same use case the chat
 * payload consults. Kept under the permission-group keys so saving a group refreshes it. Disabled
 * without an owner.
 */
export function useComputerUseAvailability(owner: ComputerUseOwner | null) {
  const scope = owner && 'organizationId' in owner ? 'organization' : 'workspace'
  const id = owner ? ('organizationId' in owner ? owner.organizationId : owner.workspaceId) : ''
  return useQuery({
    queryKey: permissionGroupKeys.computerUseAvailability(scope, id),
    queryFn: async ({ signal }) => {
      const { available } =
        scope === 'organization'
          ? await requestJson(organizationComputerUseAvailabilityContract, {
              params: { id },
              signal,
            })
          : await requestJson(workspaceComputerUseAvailabilityContract, { params: { id }, signal })
      return available
    },
    enabled: owner !== null,
    staleTime: PERMISSION_GROUPS_STALE_TIME,
    retry: shouldRetrySettingsRead,
    retryOnMount: true,
  })
}
