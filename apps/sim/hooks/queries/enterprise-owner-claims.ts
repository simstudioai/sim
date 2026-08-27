import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getEnterpriseOwnerClaimContract } from '@/lib/api/contracts/enterprise-owner-claims'

export const ENTERPRISE_OWNER_CLAIM_DETAILS_STALE_TIME = 30 * 1000

export const enterpriseOwnerClaimKeys = {
  all: ['enterprise-owner-claims'] as const,
  details: () => [...enterpriseOwnerClaimKeys.all, 'detail'] as const,
  detail: (claimId: string, token: string | null, viewerId: string | null) =>
    [...enterpriseOwnerClaimKeys.details(), claimId, token ?? '', viewerId ?? ''] as const,
}

export function useEnterpriseOwnerClaimDetails(
  claimId: string | undefined,
  token: string | null,
  viewerId: string | null,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: enterpriseOwnerClaimKeys.detail(claimId ?? '', token, viewerId),
    queryFn: ({ signal }) =>
      requestJson(getEnterpriseOwnerClaimContract, {
        params: { id: claimId as string },
        query: { token: token as string },
        signal,
      }),
    enabled: Boolean(claimId && token) && (options?.enabled ?? true),
    staleTime: ENTERPRISE_OWNER_CLAIM_DETAILS_STALE_TIME,
    retry: false,
  })
}
