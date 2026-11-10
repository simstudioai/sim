'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import Link from 'next/link'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { usePlatformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

interface UpgradeNoticeProps {
  /** Names the gated section, such as `Sandboxes require an active Max plan`. */
  title: string
  description: string
  /** Members who cannot act on it see the reason without an action that would dead-end them. */
  canUpgrade: boolean
}

/** A section the workspace's plan does not include, with the way to Billing for those who may upgrade. */
export function UpgradeNotice({ title, description, canUpgrade }: UpgradeNoticeProps) {
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        canUpgrade ? (
          <Button
            variant='primary'
            render={<Link href={hrefFor(surfaceHref(scope, '/settings/billing/plans'))} />}
          >
            Upgrade to Max
          </Button>
        ) : undefined
      }
    />
  )
}
