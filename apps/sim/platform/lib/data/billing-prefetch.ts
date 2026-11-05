import 'server-only'
import { type DehydratedState, dehydrate } from '@tanstack/react-query'
import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import { ORGANIZATION_BILLING_SUMMARY_STALE_TIME } from '@/hooks/queries/organization-billing-summary'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'
import { makeQueryClient } from '@/hooks/queries/utils/query-client'
import { serverRequestJson } from '@/platform/lib/data/server-request'

/** A slow read gives up its first-paint seat rather than hold the document; the client fetches it. */
const PREFETCH_TIMEOUT_MS = 2_000

/** The billing summary, for the section's first paint. */
export async function prefetchBillingSummary(organizationId: string): Promise<DehydratedState> {
  const queryClient = makeQueryClient()
  await queryClient.prefetchQuery({
    queryKey: organizationKeys.billingSummary(organizationId),
    queryFn: () =>
      serverRequestJson(getOrganizationBillingSummaryContract, {
        params: { id: organizationId },
        signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS),
      }),
    staleTime: ORGANIZATION_BILLING_SUMMARY_STALE_TIME,
  })
  return dehydrate(queryClient)
}
