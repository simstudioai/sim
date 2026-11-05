import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import { ORGANIZATION_BILLING_SUMMARY_STALE_TIME } from '@/hooks/queries/organization-billing-summary'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { prefetchRequestJson } from '@/platform/lib/data/server-request'

/** The billing summary, for the section's first paint. */
export async function prefetchBillingSummary(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: organizationKeys.billingSummary(organizationId),
    queryFn: () =>
      prefetchRequestJson(getOrganizationBillingSummaryContract, {
        params: { id: organizationId },
      }),
    staleTime: ORGANIZATION_BILLING_SUMMARY_STALE_TIME,
  })
  return dehydrate(queryClient)
}
