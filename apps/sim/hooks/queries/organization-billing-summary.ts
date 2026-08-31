import { queryOptions, useQuery } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getOrganizationBillingSummaryContract } from '@/lib/api/contracts/organization'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

export const ORGANIZATION_BILLING_SUMMARY_STALE_TIME = 30 * 1000

export function shouldRetryOrganizationBillingSummary(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= 1) return false
  if (!isApiClientError(error)) return true
  return error.status === 408 || error.status === 429 || error.status >= 500
}

export function organizationBillingSummaryOptions(orgId: string) {
  return queryOptions({
    queryKey: organizationKeys.billingSummary(orgId),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationBillingSummaryContract, {
        params: { id: orgId },
        signal,
      }),
    retry: shouldRetryOrganizationBillingSummary,
    retryOnMount: true,
    staleTime: ORGANIZATION_BILLING_SUMMARY_STALE_TIME,
  })
}

export function useOrganizationBillingSummary(orgId: string, options?: { enabled?: boolean }) {
  return useQuery({
    ...organizationBillingSummaryOptions(orgId),
    enabled: !!orgId && (options?.enabled ?? true),
  })
}
