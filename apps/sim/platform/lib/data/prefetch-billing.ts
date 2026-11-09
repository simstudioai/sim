import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing/get-organization-billing-summary'
import { ORGANIZATION_BILLING_SUMMARY_STALE_TIME } from '@/hooks/queries/organization-billing-summary'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

/** The billing summary, for the section's first paint. */
export async function prefetchBillingSummary(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: organizationKeys.billingSummary(organizationId),
    queryFn: () =>
      withinPrefetchBudget(async () => {
        const { principal } = await requireSessionViewer()
        return asRouteResponse(getOrganizationBillingSummaryContract, {
          success: true,
          data: await getOrganizationBillingSummary.execute({
            principal,
            input: { organizationId },
          }),
        })
      }),
    staleTime: ORGANIZATION_BILLING_SUMMARY_STALE_TIME,
  })
  return dehydrate(queryClient)
}
