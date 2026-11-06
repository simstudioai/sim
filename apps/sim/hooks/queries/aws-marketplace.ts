import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  getAwsMarketplaceClaimContract,
  linkAwsMarketplaceLicenseContract,
  listAccountAwsMarketplaceLicensesContract,
  listOrganizationAwsMarketplaceLicensesContract,
  registerAwsMarketplaceLicenseToAccountContract,
  saveAwsMarketplaceClaimContactContract,
} from '@/lib/api/contracts/aws-marketplace'

const AWS_MARKETPLACE_CLAIM_STALE_TIME = 30 * 1000
const AWS_MARKETPLACE_LICENSES_STALE_TIME = 60 * 1000

const awsMarketplaceKeys = {
  all: ['aws-marketplace'] as const,
  claims: () => [...awsMarketplaceKeys.all, 'claim'] as const,
  /** The claim rides in an httpOnly cookie; the viewer scopes which organizations it lists. */
  claim: (viewerId: string) => [...awsMarketplaceKeys.claims(), viewerId] as const,
  licenses: () => [...awsMarketplaceKeys.all, 'licenses'] as const,
  /** An organization's licenses, or with null the viewer's own account's. */
  licenseList: (organizationId: string | null) =>
    [...awsMarketplaceKeys.licenses(), organizationId ?? ''] as const,
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

/** Taking a license spends the claim and changes what billing shows, so both are read again. */
function useInvalidateAwsMarketplace() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: awsMarketplaceKeys.all })
}

export function useLinkAwsMarketplaceLicense() {
  const invalidate = useInvalidateAwsMarketplace()
  return useMutation({
    mutationFn: (body: ContractBodyInput<typeof linkAwsMarketplaceLicenseContract>) =>
      requestJson(linkAwsMarketplaceLicenseContract, { body }),
    onSuccess: invalidate,
  })
}

export function useRegisterAwsMarketplaceLicenseToAccount() {
  const invalidate = useInvalidateAwsMarketplace()
  return useMutation({
    mutationFn: (body: ContractBodyInput<typeof registerAwsMarketplaceLicenseToAccountContract>) =>
      requestJson(registerAwsMarketplaceLicenseToAccountContract, { body }),
    onSuccess: invalidate,
  })
}

export function useSaveAwsMarketplaceClaimContact() {
  const invalidate = useInvalidateAwsMarketplace()
  return useMutation({
    mutationFn: (body: ContractBodyInput<typeof saveAwsMarketplaceClaimContactContract>) =>
      requestJson(saveAwsMarketplaceClaimContactContract, { body }),
    onSuccess: invalidate,
  })
}

/**
 * Whether AWS Marketplace bills this organization or the viewer's own account: a pending or active
 * license on either. Pending until both reads settle.
 */
export function useAwsMarketplaceBilling(organizationId: string | null) {
  const organizationLicenses = useAwsMarketplaceLicenses(organizationId)
  const accountLicenses = useAwsMarketplaceLicenses(null)
  return {
    isPending: organizationLicenses.isPending || accountLicenses.isPending,
    billedThroughMarketplace: [
      ...(organizationLicenses.data ?? []),
      ...(accountLicenses.data ?? []),
    ].some((license) => license.status !== 'inactive'),
  }
}

/** The Marketplace subscriptions an organization holds, or with null the viewer's own account. */
export function useAwsMarketplaceLicenses(organizationId: string | null) {
  return useQuery({
    queryKey: awsMarketplaceKeys.licenseList(organizationId),
    queryFn: ({ signal }) =>
      organizationId
        ? requestJson(listOrganizationAwsMarketplaceLicensesContract, {
            params: { id: organizationId },
            signal,
          })
        : requestJson(listAccountAwsMarketplaceLicensesContract, { signal }),
    staleTime: AWS_MARKETPLACE_LICENSES_STALE_TIME,
    select: (data) => data.licenses,
  })
}
