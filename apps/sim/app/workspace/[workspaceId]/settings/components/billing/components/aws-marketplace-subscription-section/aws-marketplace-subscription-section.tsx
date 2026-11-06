'use client'

import { Badge } from '@sim/emcn'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useOrganizationAwsMarketplaceLicenses } from '@/hooks/queries/aws-marketplace'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

interface AwsMarketplaceSubscriptionSectionProps {
  organizationId: string
}

/** Read-only: AWS requires buyers to see their subscription status in the product. */
export function AwsMarketplaceSubscriptionSection({
  organizationId,
}: AwsMarketplaceSubscriptionSectionProps) {
  const { data: licenses } = useOrganizationAwsMarketplaceLicenses(organizationId)
  if (!licenses?.length) return null

  return (
    <SettingsSection label='AWS Marketplace subscription'>
      <div className='flex flex-col gap-6'>
        {licenses.map((license) => {
          const rows = [
            { label: 'Plan', value: license.dimension ?? 'Not specified' },
            { label: 'Quantity', value: license.quantity?.toLocaleString() ?? 'Not specified' },
            {
              label: 'Expires',
              value: license.expiresAt ? formatDate(license.expiresAt) : 'No expiry',
            },
            { label: 'Last verified', value: formatDate(license.lastVerifiedAt) },
          ]
          return (
            <div key={license.id} className='flex flex-col gap-4'>
              <div className='flex items-center justify-between'>
                <span className='text-[var(--text-body)] text-small'>Status</span>
                <Badge variant={license.status === 'active' ? 'green' : 'gray'} size='sm'>
                  {license.status === 'active' ? 'Active' : 'Inactive'}
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
