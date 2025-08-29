import { useCallback, useEffect, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { useActiveOrganization } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { UsageHeader } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/shared/usage-header'
import {
  UsageLimit,
  type UsageLimitRef,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/components'
import { useOrganizationStore } from '@/stores/organization'
import { useSubscriptionStore } from '@/stores/subscription/store'

const logger = createLogger('TeamUsage')

interface TeamUsageProps {
  hasAdminAccess: boolean
}

export function TeamUsage({ hasAdminAccess }: TeamUsageProps) {
  const { data: activeOrg } = useActiveOrganization()
  const { getSubscriptionStatus } = useSubscriptionStore()

  const {
    organizationBillingData: billingData,
    loadOrganizationBillingData,
    isLoadingOrgBilling,
    error,
  } = useOrganizationStore()

  useEffect(() => {
    if (activeOrg?.id) {
      loadOrganizationBillingData(activeOrg.id)
    }
  }, [activeOrg?.id, loadOrganizationBillingData])

  const handleLimitUpdated = useCallback(
    async (newLimit: number) => {
      // Reload the organization billing data to reflect the new limit
      if (activeOrg?.id) {
        await loadOrganizationBillingData(activeOrg.id, true)
      }
    },
    [activeOrg?.id, loadOrganizationBillingData]
  )

  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  if (isLoadingOrgBilling) {
    return (
      <div className='rounded-[8px] border bg-background p-3 shadow-xs'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <Skeleton className='h-5 w-16' />
              <Skeleton className='h-4 w-20' />
            </div>
            <div className='flex items-center gap-1 text-xs'>
              <Skeleton className='h-4 w-8' />
              <span className='text-muted-foreground'>/</span>
              <Skeleton className='h-4 w-8' />
            </div>
          </div>
          <Skeleton className='h-2 w-full rounded' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant='destructive'>
        <AlertCircle className='h-4 w-4' />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!billingData) {
    return null
  }

  const currentUsage = billingData.totalCurrentUsage || 0
  const currentCap = billingData.totalUsageLimit || billingData.minimumBillingAmount || 0
  const minimumBilling = billingData.minimumBillingAmount || 0
  const seatsCount = billingData.seatsCount || 1
  const percentUsed =
    currentCap > 0 ? Math.round(Math.min((currentUsage / currentCap) * 100, 100)) : 0
  const status: 'ok' | 'warning' | 'exceeded' =
    percentUsed >= 100 ? 'exceeded' : percentUsed >= 80 ? 'warning' : 'ok'

  const subscription = getSubscriptionStatus()
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
              returnUrl: `${window.location.origin}/workspace?billing=updated`,
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
            onLimitUpdated={handleLimitUpdated}
          />
        ) : (
          <span className='text-muted-foreground text-xs tabular-nums'>
            ${currentCap.toFixed(0)}
          </span>
        )
      }
      progressValue={percentUsed}
    />
  )
}
