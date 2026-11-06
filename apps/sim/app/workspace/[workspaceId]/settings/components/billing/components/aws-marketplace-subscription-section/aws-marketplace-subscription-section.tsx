'use client'

import { Badge } from '@sim/emcn'
import { formatDate } from '@sim/utils/formatting'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useAwsMarketplaceLicenses } from '@/hooks/queries/aws-marketplace'

const STATUS_BADGES = {
  active: { label: 'Active', variant: 'green' },
  pending: { label: 'Confirming with AWS', variant: 'amber' },
  inactive: { label: 'Inactive', variant: 'gray' },
} as const

interface AwsMarketplaceSubscriptionSectionProps {
  /** Null reads the licenses registered to the viewer's own account. */
  organizationId: string | null
  label?: string
}

/** Read-only: AWS requires buyers to see their subscription status in the product. */
export function AwsMarketplaceSubscriptionSection({
  organizationId,
  label = 'AWS Marketplace subscription',
}: AwsMarketplaceSubscriptionSectionProps) {
  const { data: licenses, error, isFetching, refetch } = useAwsMarketplaceLicenses(organizationId)
  if (error && !licenses) {
    return (
      <SettingsSection label={label}>
        <SettingsQueryErrorState
          variant='inline'
          error={error}
          fallback='Could not load your AWS Marketplace subscription.'
          isRetrying={isFetching}
          onRetry={() => refetch()}
        />
      </SettingsSection>
    )
  }
  if (!licenses?.length) return null

  return (
    <SettingsSection label={label}>
      <div className='flex flex-col gap-6'>
        {licenses.map((license) => {
          const badge = STATUS_BADGES[license.status]
          const rows = [
            { label: 'Plan', value: license.dimension ?? 'Not specified' },
            { label: 'Quantity', value: license.quantity?.toLocaleString() ?? 'Not specified' },
            {
              label: 'Expires',
              value: license.expiresAt ? formatDate(new Date(license.expiresAt)) : 'No expiry',
            },
            { label: 'Last verified', value: formatDate(new Date(license.lastVerifiedAt)) },
          ]
          return (
            <div key={license.id} className='flex flex-col gap-4'>
              <div className='flex items-center justify-between'>
                <span className='text-[var(--text-body)] text-small'>Status</span>
                <Badge variant={badge.variant} size='sm'>
                  {badge.label}
                </Badge>
              </div>
              {rows.map((row) => (
                <div key={row.label} className='flex items-center justify-between'>
                  <span className='text-[var(--text-body)] text-small'>{row.label}</span>
                  <span className='text-[var(--text-muted)] text-small'>{row.value}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </SettingsSection>
  )
}
