import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing/get-organization-billing-summary'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { ORGANIZATION_BILLING_SUMMARY_STALE_TIME } from '@/hooks/queries/organization-billing-summary'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import {
  asRouteResponse,
  requireSessionViewer,
  withinPrefetchBudget,
} from '@/platform/lib/data/server-read'

interface BillingPrefetch {
  state: DehydratedState
  /**
   * Whether the organization bills through Enterprise, which has no credit usage page. Null when the
   * read gave up inside its budget, so the browser decides.
   */
  enterprise: boolean | null
}

/** The billing summary, for the section's first paint and its server-side page gates. */
export async function prefetchBillingSummary(organizationId: string): Promise<BillingPrefetch> {
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
  const summary = queryClient.getQueryData<
    ContractJsonResponse<typeof getOrganizationBillingSummaryContract>
  >(organizationKeys.billingSummary(organizationId))
  return {
    state: dehydrate(queryClient),
    enterprise: summary ? isEnterprise(summary.data.subscriptionPlan) : null,
  }
}
