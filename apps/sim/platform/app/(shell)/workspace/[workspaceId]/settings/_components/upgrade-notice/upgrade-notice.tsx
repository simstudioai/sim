'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { platformHref } from '@/platform/lib/navigation'

interface UpgradeNoticeProps {
  /** Names the gated section, such as `Sandboxes require an active Max plan`. */
  title: string
  description: string
  /** Members who cannot act on it see the reason without an action that would dead-end them. */
  canUpgrade: boolean
}

/** A section the workspace's plan does not include, with the way to Billing for those who may upgrade. */
export function UpgradeNotice({ title, description, canUpgrade }: UpgradeNoticeProps) {
  const search = useSearchParams()
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        canUpgrade ? (
          <Button
            variant='primary'
            render={<Link href={platformHref('/settings/billing/plans', search)} />}
          >
            Upgrade to Max
          </Button>
        ) : undefined
      }
    />
  )
}
