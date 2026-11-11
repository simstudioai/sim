'use client'

import { Fragment } from 'react'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { useAwsMarketplaceSubscription } from '@/platform/lib/data/aws-marketplace'

interface AwsMarketplaceSubscriptionProps {
  /** Null reads the licenses registered to the viewer's own account. */
  organizationId: string | null
  title: string
}

/** Read-only: AWS requires buyers to see their subscription status in the product. */
export function AwsMarketplaceSubscription({
  organizationId,
  title,
}: AwsMarketplaceSubscriptionProps) {
  const subscription = useAwsMarketplaceSubscription(organizationId)
  if (subscription.failed)
    return (
      <FailureNotice
        message='Could not load your AWS Marketplace subscription.'
        retrying={subscription.retrying}
        onRetry={subscription.retry}
      />
    )
  if (subscription.licenses.length === 0) return null
  return (
    <SettingsSection title={title}>
      {subscription.licenses.map((license) => (
        <Fragment key={license.id}>
          <SettingsRow label='Status' description='Your AWS Marketplace subscription'>
            <StatusTag label={license.statusLabel} intent={license.statusIntent} />
          </SettingsRow>
          {license.rows.map((row) => (
            <SettingsRow key={row.label} label={row.label}>
              <span data-type='T067'>{row.value}</span>
            </SettingsRow>
          ))}
        </Fragment>
      ))}
    </SettingsSection>
  )
}
