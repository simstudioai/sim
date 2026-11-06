'use client'

import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationDomain } from '@/lib/api/contracts/organization'
import {
  useAddOrganizationDomain,
  useOrganizationDomains,
  useRemoveOrganizationDomain,
  useVerifyOrganizationDomain,
} from '@/ee/sso/hooks/domains'
import { useDeleteSSOProvider, useSetPrimarySSOProvider, useSSOProviders } from '@/ee/sso/hooks/sso'
import { useOrganizationSsoPolicy, useUpdateOrganizationSsoPolicy } from '@/ee/sso/hooks/sso-policy'
import { useOrganizationPlanSeats } from '@/hooks/queries/organization-plan-seats'
import { toast } from '@/platform/shared/toast'

/** Whether members must use the identity provider, and the two ways to change it. */
export function useSsoRequirement(organizationId: string) {
  const policy = useOrganizationSsoPolicy(organizationId)
  const { data } = policy
  const updatePolicy = useUpdateOrganizationSsoPolicy()
  return {
    policy,
    // Turning it off stays available: losing the provider must not strand the setting.
    disabled: !data || updatePolicy.isPending || (!data.hasVerifiedProvider && !data.requireSso),
    turnOff: async () => {
      try {
        await updatePolicy.mutateAsync({ organizationId, requireSso: false })
        toast.success('Members can sign in with any method')
      } catch (failure) {
        toast.error(getErrorMessage(failure, 'Failed to update the sign-in requirement'))
      }
    },
    turnOn: async () => {
      await updatePolicy.mutateAsync({ organizationId, requireSso: true })
      toast.success('Members must now sign in through SSO')
    },
  }
}

/** The organization's identity providers, its plan, and the two row actions that confirm first. */
export function useSsoProviderSettings(organizationId: string, billingEnabled: boolean) {
  const billing = useOrganizationPlanSeats(organizationId, { enabled: billingEnabled })
  const providers = useSSOProviders({ organizationId })
  const deleteProvider = useDeleteSSOProvider()
  const setPrimaryProvider = useSetPrimarySSOProvider()
  return {
    billing,
    providers,
    removeProvider: async (providerId: string) => {
      await deleteProvider.mutateAsync(providerId)
      toast.success('Identity provider deleted')
    },
    makePrimary: async (providerId: string) => {
      await setPrimaryProvider.mutateAsync(providerId)
      toast.success(`${providerId} is now the primary provider`)
    },
  }
}

export function useDomainVerification(organizationId: string, domain: OrganizationDomain) {
  const verifyDomain = useVerifyOrganizationDomain()
  return {
    pending: verifyDomain.isPending,
    verify: async () => {
      try {
        await verifyDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
        toast.success(`${domain.domain} verified`)
      } catch (error) {
        toast.error(getErrorMessage(error, 'Verification failed — check the DNS record and retry'))
      }
    },
  }
}

export function useDomainList(organizationId: string, active: boolean) {
  const read = useOrganizationDomains(organizationId, { enabled: active })
  const addDomain = useAddOrganizationDomain()
  const removeDomain = useRemoveOrganizationDomain()
  return {
    read,
    addPending: addDomain.isPending,
    removePending: removeDomain.isPending,
    add: async (domain: string, onAdded: () => void) => {
      try {
        await addDomain.mutateAsync({ orgId: organizationId, body: { domain } })
        onAdded()
        toast.success(`${domain} added — add the DNS record and verify`)
      } catch (failure) {
        toast.error(getErrorMessage(failure, 'Failed to add domain'))
      }
    },
    remove: async (domain: OrganizationDomain) => {
      await removeDomain.mutateAsync({ orgId: organizationId, domainId: domain.id })
      toast.success(`${domain.domain} removed`)
    },
  }
}
