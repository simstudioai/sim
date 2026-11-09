'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useUpdateOrganizationUsageLimit } from '@/hooks/queries/organization'
import { useInvoices, useUpdateUsageLimit } from '@/hooks/queries/subscription'
import { organizationKeys } from '@/hooks/queries/utils/organization-keys'

/**
 * Where an organization's Billing settings act. A personal organization's billing is its owner's
 * own, exactly as before personal organizations: their invoices, their usage limit, their billing
 * portal and their subscription (cancelled or restored without an organization reference). A team
 * acts on the organization.
 */
export function resolveBillingScope(organizationId: string, personal: boolean) {
  return personal
    ? {
        personal: true as const,
        invoices: { context: 'user' as const },
        portal: { context: 'user' as const },
        subscriptionReference: {},
      }
    : {
        personal: false as const,
        invoices: { context: 'organization' as const, organizationId },
        portal: { context: 'organization' as const, organizationId },
        subscriptionReference: { referenceId: organizationId },
      }
}

/** {@link resolveBillingScope} with the invoices and usage-limit writes bound to that scope. */
export function useBillingScope(organizationId: string, personal: boolean) {
  const scope = resolveBillingScope(organizationId, personal)
  const queryClient = useQueryClient()
  const invoiceList = useInvoices(scope.invoices)
  const organizationLimit = useUpdateOrganizationUsageLimit()
  const personalLimit = useUpdateUsageLimit()
  const updateLimit = {
    isPending: personal ? personalLimit.isPending : organizationLimit.isPending,
    async mutateAsync(limit: number) {
      if (!personal) return organizationLimit.mutateAsync({ organizationId, limit })
      const result = await personalLimit.mutateAsync({ limit })
      await queryClient.invalidateQueries({
        queryKey: organizationKeys.billingSummary(organizationId),
      })
      return result
    },
  }
  return { ...scope, invoiceList, updateLimit }
}
