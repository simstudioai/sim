'use client'

import { useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth/auth-client'
import { getSubscriptionStatus } from '@/lib/billing/client/utils'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { UsageHeader } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/usage-header/usage-header'
import {
  UsageLimit,
  type UsageLimitRef,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/usage-limit'
import { useOrganizationBilling } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'

interface TeamUsageProps {
  hasAdminAccess: boolean
}

export function TeamUsage({ hasAdminAccess }: TeamUsageProps) {
  const { data: activeOrg } = useActiveOrganization()
  const { data: subscriptionData } = useSubscriptionData()
  const subscriptionStatus = getSubscriptionStatus(subscriptionData?.data)

  const {
    data: billingData,
    isLoading: isLoadingOrgBilling,
    error,
  } = useOrganizationBilling(activeOrg?.id || '')

  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  if (isLoadingOrgBilling) {
    return (
      <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
        <div className='flex flex-col gap-[8px] px-[14px] py-[12px]'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-[8px]'>
              <Skeleton className='h-5 w-16 rounded-[4px]' />
              <Skeleton className='h-4 w-20 rounded-[4px]' />
            </div>
            <div className='flex items-center gap-[4px] text-[12px]'>
              <Skeleton className='h-4 w-8 rounded-[4px]' />
              <span className='text-[var(--text-muted)]'>/</span>
              <Skeleton className='h-4 w-8 rounded-[4px]' />
            </div>
          </div>
          <Skeleton className='h-[6px] w-full rounded-full' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[14px] py-[12px]'>
        <p className='text-center text-[11px] text-[var(--text-error)] leading-tight'>
          {error instanceof Error ? error.message : 'Failed to load billing data'}
        </p>
      </div>
    )
  }

  if (!billingData) {
    return null
  }

  const currentUsage = billingData.totalCurrentUsage ?? 0
  const currentCap = billingData.totalUsageLimit ?? billingData.minimumBillingAmount ?? 0
  const minimumBilling = billingData.minimumBillingAmount ?? 0
  const seatsCount = billingData.seatsCount ?? 0
  const percentUsed =
    currentCap > 0 ? Math.round(Math.min((currentUsage / currentCap) * 100, 100)) : 0
  const status: 'ok' | 'warning' | 'exceeded' =
    percentUsed >= 100 ? 'exceeded' : percentUsed >= 80 ? 'warning' : 'ok'

  const subscription = subscriptionStatus
  const title = subscription.isEnterprise
    ? 'Enterprise'
    : subscription.isTeam
      ? 'Team'
      : (subscription.plan || 'Free').charAt(0).toUpperCase() +
        (subscription.plan || 'Free').slice(1)

  return (
    <UsageHeader
      title={title}
      gradientTitle={!subscription.isFree}
      showBadge={!!(hasAdminAccess && activeOrg?.id && !subscription.isEnterprise)}
      badgeText={subscription.isEnterprise ? undefined : 'Increase Limit'}
      onBadgeClick={() => {
        if (!subscription.isEnterprise) usageLimitRef.current?.startEdit()
      }}
      seatsText={`${seatsCount} seats`}
      current={currentUsage}
      limit={currentCap}
      isBlocked={Boolean(billingData?.billingBlocked)}
      status={status}
      percentUsed={percentUsed}
      onResolvePayment={async () => {
        try {
          const res = await fetch('/api/billing/portal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: 'organization',
              organizationId: activeOrg?.id,
              returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
            }),
          })
          const data = await res.json()
          if (!res.ok || !data?.url)
            throw new Error(data?.error || 'Failed to start billing portal')
          window.location.href = data.url
        } catch (e) {
          alert(e instanceof Error ? e.message : 'Failed to open billing portal')
        }
      }}
      rightContent={
        hasAdminAccess && activeOrg?.id && !subscription.isEnterprise ? (
          <UsageLimit
            ref={usageLimitRef}
            currentLimit={currentCap}
            currentUsage={currentUsage}
            canEdit={hasAdminAccess && !subscription.isEnterprise}
            minimumLimit={minimumBilling}
            context='organization'
            organizationId={activeOrg.id}
          />
        ) : (
          <span className='font-medium text-[12px] text-[var(--text-secondary)] tabular-nums'>
            ${currentCap.toFixed(0)}
          </span>
        )
      }
      progressValue={percentUsed}
    />
  )
}
