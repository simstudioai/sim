import { queryOptions, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationPlanSeatsContract,
  type OrganizationPlanSeatsResponse,
} from '@/lib/api/contracts/organization'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { shouldRetrySettingsRead } from '@/hooks/queries/utils/settings-read-retry'

const ORGANIZATION_PLAN_SEATS_STALE_TIME = 30 * 1000

/** Shared cache options for plan access and seat reservations without usage analytics. */
export function organizationPlanSeatsOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.planSeats(organizationId),
    queryFn: ({ signal }): Promise<OrganizationPlanSeatsResponse> =>
      requestJson(getOrganizationPlanSeatsContract, { params: { id: organizationId }, signal }),
    staleTime: ORGANIZATION_PLAN_SEATS_STALE_TIME,
    retry: shouldRetrySettingsRead,
    retryOnMount: true,
  })
}

/** Reads plan access and seat reservations for settings and invitation flows. */
export function useOrganizationPlanSeats(organizationId: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...organizationPlanSeatsOptions(organizationId),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
  })
}
