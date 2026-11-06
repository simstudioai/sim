import { useCallback } from 'react'
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
import { useSession } from '@/lib/auth/client'

const AWS_MARKETPLACE_CLAIM_STALE_TIME = 30 * 1000
const AWS_MARKETPLACE_LICENSES_STALE_TIME = 60 * 1000

const awsMarketplaceKeys = {
  all: ['aws-marketplace'] as const,
  claims: () => [...awsMarketplaceKeys.all, 'claim'] as const,
  /** The claim rides in an httpOnly cookie; the viewer scopes which organizations it lists. */
  claim: (viewerId: string) => [...awsMarketplaceKeys.claims(), viewerId] as const,
  licenses: () => [...awsMarketplaceKeys.all, 'licenses'] as const,
  /** An organization's licenses, or one viewer's own account's: the session scopes that read. */
  licenseList: (scope: { organizationId: string } | { viewerId: string }) =>
    [...awsMarketplaceKeys.licenses(), scope] as const,
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
 * Whether AWS Marketplace bills this scope: the organization, or with null the viewer's account.
 * Until `isResolved`, how the scope is billed is unknown, and an unknown state gates plan changes
 * the same as Marketplace billing does: a failed lookup must not open Stripe checkout to a
 * customer AWS bills. `retry` reads it again.
 */
export function useAwsMarketplaceBilling(organizationId: string | null) {
  const licenses = useAwsMarketplaceLicenses(organizationId)
  const { refetch } = licenses
  const retry = useCallback(() => {
    void refetch()
  }, [refetch])
  return {
    isResolved: licenses.data !== undefined,
    isError: licenses.isError,
    isRetrying: licenses.isFetching,
    retry,
    billedThroughMarketplace:
      licenses.data?.some((license) => license.status !== 'inactive') ?? false,
  }
}

/** The Marketplace subscriptions an organization holds, or with null the viewer's own account. */
export function useAwsMarketplaceLicenses(organizationId: string | null) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? ''
  return useQuery({
    queryKey: awsMarketplaceKeys.licenseList(organizationId ? { organizationId } : { viewerId }),
    enabled: Boolean(organizationId || viewerId),
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
