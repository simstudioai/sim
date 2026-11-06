import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  getAwsMarketplaceClaimContract,
  linkAwsMarketplaceLicenseContract,
  registerAwsMarketplaceLicenseToAccountContract,
} from '@/lib/api/contracts/aws-marketplace'

const AWS_MARKETPLACE_CLAIM_STALE_TIME = 30 * 1000

const awsMarketplaceKeys = {
  all: ['aws-marketplace'] as const,
  claims: () => [...awsMarketplaceKeys.all, 'claim'] as const,
  /** The claim rides in an httpOnly cookie; the viewer scopes which organizations it lists. */
  claim: (viewerId: string) => [...awsMarketplaceKeys.claims(), viewerId] as const,
}

export function useAwsMarketplaceClaim(viewerId: string | null) {
  return useQuery({
    queryKey: awsMarketplaceKeys.claim(viewerId ?? ''),
    queryFn: ({ signal }) => requestJson(getAwsMarketplaceClaimContract, { signal }),
    enabled: Boolean(viewerId),
    staleTime: AWS_MARKETPLACE_CLAIM_STALE_TIME,
    retry: false,
  })
}

export function useLinkAwsMarketplaceLicense() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ContractBodyInput<typeof linkAwsMarketplaceLicenseContract>) =>
      requestJson(linkAwsMarketplaceLicenseContract, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: awsMarketplaceKeys.claims() })
    },
  })
}

export function useRegisterAwsMarketplaceLicenseToAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ContractBodyInput<typeof registerAwsMarketplaceLicenseToAccountContract>) =>
      requestJson(registerAwsMarketplaceLicenseToAccountContract, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: awsMarketplaceKeys.claims() })
    },
  })
}
