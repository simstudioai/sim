'use client'

import { useAwsMarketplaceLicenses } from '@/hooks/queries/aws-marketplace'
import { formatInstantDate } from '@/platform/shared/time'

const STATUS = {
  active: { label: 'Active', intent: 'success' },
  pending: { label: 'Confirming with AWS', intent: 'warning' },
  inactive: { label: 'Inactive', intent: 'neutral' },
} as const

/**
 * The AWS Marketplace subscriptions an organization holds, or with null the viewer's own account.
 * Read-only: AWS requires buyers to see their subscription status in the product.
 */
export function useAwsMarketplaceSubscription(organizationId: string | null) {
  const query = useAwsMarketplaceLicenses(organizationId)
  return {
    failed: query.isError && !query.data,
    retrying: query.isFetching,
    retry: () => void query.refetch(),
    licenses: (query.data ?? []).map((license) => ({
      id: license.id,
      statusLabel: STATUS[license.status].label,
      statusIntent: STATUS[license.status].intent,
      rows: [
        { label: 'Plan', value: license.dimension ?? 'Not specified' },
        { label: 'Quantity', value: license.quantity?.toLocaleString() ?? 'Not specified' },
        {
          label: 'Expires',
          value: license.expiresAt ? formatInstantDate(license.expiresAt) : 'No expiry',
        },
        { label: 'Last verified', value: formatInstantDate(license.lastVerifiedAt) },
      ],
    })),
  }
}
