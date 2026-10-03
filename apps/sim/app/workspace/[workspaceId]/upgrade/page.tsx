import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  buildHostedUpgradeUrl,
  isUpgradeReason,
  UPGRADE_REASON_PARAM,
} from '@/lib/billing/upgrade-reasons'
import { isBillingEnabled, isHosted } from '@/lib/core/config/env-flags'
import { Upgrade } from '@/app/workspace/[workspaceId]/upgrade/upgrade'

export const metadata: Metadata = { title: 'Upgrade' }

export default async function UpgradePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])

  // Both are build constants, so resolve them here rather than mounting a page
  // whose only job would be to navigate away.
  if (!isHosted) {
    const rawReason = query[UPGRADE_REASON_PARAM]
    const reasonValue = Array.isArray(rawReason) ? rawReason[0] : rawReason
    redirect(buildHostedUpgradeUrl(isUpgradeReason(reasonValue) ? reasonValue : undefined))
  }

  if (!isBillingEnabled) {
    redirect(`/workspace/${workspaceId}/home`)
  }

  return (
    <Suspense fallback={<div className='h-full bg-[var(--bg)]' />}>
      <Upgrade workspaceId={workspaceId} />
    </Suspense>
  )
}
