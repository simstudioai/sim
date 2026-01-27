'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Info } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Combobox, Label, Switch, Tooltip } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { USAGE_THRESHOLDS } from '@/lib/billing/client/consts'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CancelSubscription,
  CreditBalance,
  PlanCard,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/components'
import {
  ENTERPRISE_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
  TEAM_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/plan-configs'
import {
  getSubscriptionPermissions,
  getVisiblePlans,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/subscription/subscription-permissions'
import { UsageHeader } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/usage-header/usage-header'
import {
  UsageLimit,
  type UsageLimitRef,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/usage-limit'
import {
  useBillingUsageNotifications,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/queries/workspace'

const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000, // 3 seconds
  TYPEFORM_ENTERPRISE_URL: 'https://form.typeform.com/to/jqCO12pF',
  PRO_PRICE: '$20',
  TEAM_PRICE: '$40',
  INITIAL_TEAM_SEATS: 1,
} as const

type TargetPlan = 'pro' | 'team'

interface WorkspaceAdmin {
  userId: string
  email: string
  permissionType: string
}

/**
 * Skeleton component for subscription loading state.
 */
function SubscriptionSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[20px]'>
      {/* UsageHeader skeleton */}
      <div className='flex flex-col gap-[12px]'>
        <div className='flex items-center justify-between'>
          {/* Left side: plan name and usage */}
          <div className='flex flex-col gap-[4px]'>
            <div className='flex h-[18px] items-center'>
              <Skeleton className='h-[12px] w-[40px] rounded-[4px]' />
            </div>
            <div className='flex h-[21px] items-center gap-[4px]'>
              <Skeleton className='h-[14px] w-[50px] rounded-[4px]' />
              <span className='font-medium text-[14px] text-[var(--text-primary)]'>/</span>
              <Skeleton className='h-[14px] w-[50px] rounded-[4px]' />
            </div>
          </div>
          {/* Right side: pills */}
          <div className='flex flex-col items-end gap-[8px]'>
            <div className='flex w-[100px] items-center gap-[4px]'>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className='h-[6px] flex-1 rounded-[2px]' />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Plan Cards */}
      <div className='flex flex-col gap-[10px]'>
        {/* Pro and Team Cards Grid */}
        <div className='grid grid-cols-2 gap-[10px]'>
          {/* Pro Plan Card */}
          <article className='flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
            <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
              <Skeleton className='h-[14px] w-[24px] rounded-[4px]' />
              <div className='flex items-baseline'>
                <Skeleton className='h-[14px] w-[28px] rounded-[4px]' />
                <Skeleton className='ml-[4px] h-[12px] w-[40px] rounded-[4px]' />
              </div>
            </div>
            <div className='flex flex-1 flex-col gap-[16px] rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[16px]'>
              <ul className='flex flex-1 flex-col gap-[14px]'>
                {[...Array(6)].map((_, i) => (
                  <li key={i} className='flex items-center gap-[8px]'>
                    <Skeleton className='h-[12px] w-[12px] flex-shrink-0 rounded-[4px]' />
                    <Skeleton className='h-[12px] w-[120px] rounded-[4px]' />
                  </li>
                ))}
              </ul>
              <Skeleton className='h-[28px] w-full rounded-[5px]' />
            </div>
          </article>

          {/* Team Plan Card */}
          <article className='flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
            <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
              <Skeleton className='h-[14px] w-[32px] rounded-[4px]' />
              <div className='flex items-baseline'>
                <Skeleton className='h-[14px] w-[28px] rounded-[4px]' />
                <Skeleton className='ml-[4px] h-[12px] w-[40px] rounded-[4px]' />
              </div>
            </div>
            <div className='flex flex-1 flex-col gap-[16px] rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[16px]'>
              <ul className='flex flex-1 flex-col gap-[14px]'>
                {[...Array(5)].map((_, i) => (
                  <li key={i} className='flex items-center gap-[8px]'>
                    <Skeleton className='h-[12px] w-[12px] flex-shrink-0 rounded-[4px]' />
                    <Skeleton className='h-[12px] w-[130px] rounded-[4px]' />
                  </li>
                ))}
              </ul>
              <Skeleton className='h-[28px] w-full rounded-[5px]' />
            </div>
          </article>
        </div>

        {/* Enterprise Card - inlineButton layout */}
        <article className='flex flex-1 flex-col overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)]'>
          <div className='flex items-center justify-between gap-[8px] px-[14px] py-[10px]'>
            <Skeleton className='h-[14px] w-[64px] rounded-[4px]' />
            <div className='flex items-baseline' />
          </div>
          <div className='flex items-center justify-between gap-[16px] rounded-t-[8px] border-[var(--border-1)] border-t bg-[var(--surface-4)] px-[14px] py-[12px]'>
            <ul className='flex flex-row flex-wrap items-center gap-x-[16px] gap-y-[8px]'>
              {[...Array(5)].map((_, i) => (
                <li key={i} className='flex items-center gap-[8px]'>
                  <Skeleton className='h-[12px] w-[12px] flex-shrink-0 rounded-[4px]' />
                  <Skeleton className='h-[12px] w-[100px] rounded-[4px]' />
                </li>
              ))}
            </ul>
            <Skeleton className='h-[28px] w-[64px] flex-shrink-0 rounded-[5px]' />
          </div>
        </article>
      </div>
    </div>
  )
}

const formatPlanName = (plan: string): string => plan.charAt(0).toUpperCase() + plan.slice(1)

/**
 * Subscription management component
 * Handles plan display, upgrades, and billing management
 */
export function Subscription() {
  const { data: session } = useSession()
  const { handleUpgrade } = useSubscriptionUpgrade()
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin
  const logger = createLogger('Subscription')

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData()
  const { data: usageLimitResponse, isLoading: isUsageLimitLoading } = useUsageLimitData()
  const { data: workspaceData, isLoading: isWorkspaceLoading } = useWorkspaceSettings(workspaceId)
  const updateWorkspaceMutation = useUpdateWorkspaceSettings()

  const { data: orgsData } = useOrganizations()
  const activeOrganization = orgsData?.activeOrganization
  const activeOrgId = activeOrganization?.id

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    activeOrgId || ''
  )

  const [upgradeError, setUpgradeError] = useState<'pro' | 'team' | null>(null)
  const usageLimitRef = useRef<UsageLimitRef | null>(null)

  const isOrgPlan =
    subscriptionData?.data?.plan === 'team' || subscriptionData?.data?.plan === 'enterprise'
  const isLoading =
    isSubscriptionLoading ||
    isUsageLimitLoading ||
    isWorkspaceLoading ||
    (isOrgPlan && isOrgBillingLoading)

  const subscription = {
    isFree: subscriptionData?.data?.plan === 'free' || !subscriptionData?.data?.plan,
    isPro: subscriptionData?.data?.plan === 'pro',
    isTeam: subscriptionData?.data?.plan === 'team',
    isEnterprise: subscriptionData?.data?.plan === 'enterprise',
    isPaid:
      subscriptionData?.data?.plan &&
      ['pro', 'team', 'enterprise'].includes(subscriptionData.data.plan) &&
      subscriptionData?.data?.status === 'active',
    plan: subscriptionData?.data?.plan || 'free',
    status: subscriptionData?.data?.status || 'inactive',
    seats: getEffectiveSeats(subscriptionData?.data),
  }

  const usage = {
    current: subscriptionData?.data?.usage?.current || 0,
    limit: subscriptionData?.data?.usage?.limit || 0,
    percentUsed: subscriptionData?.data?.usage?.percentUsed || 0,
  }

  const usageLimitData = {
    currentLimit: usageLimitResponse?.data?.currentLimit || 0,
    minimumLimit: usageLimitResponse?.data?.minimumLimit || (subscription.isPro ? 20 : 40),
  }

  const isBlocked = Boolean(subscriptionData?.data?.billingBlocked)
  const blockedReason = subscriptionData?.data?.billingBlockedReason as
    | 'payment_failed'
    | 'dispute'
    | null
  const isDispute = isBlocked && blockedReason === 'dispute'
  const isCritical = isBlocked || usage.percentUsed >= USAGE_THRESHOLDS.CRITICAL

  const billedAccountUserId = workspaceData?.settings?.workspace?.billedAccountUserId ?? null
  const workspaceAdmins: WorkspaceAdmin[] =
    workspaceData?.permissions?.users?.filter(
      (user: WorkspaceAdmin) => user.permissionType === 'admin'
    ) || []

  const updateWorkspaceSettings = async (updates: { billedAccountUserId?: string }) => {
    if (!workspaceId) return
    try {
      await updateWorkspaceMutation.mutateAsync({
        workspaceId,
        ...updates,
      })
    } catch (error) {
      logger.error('Error updating workspace settings:', { error })
      throw error
    }
  }

  useEffect(() => {
    if (upgradeError) {
      const timer = setTimeout(() => {
        setUpgradeError(null)
      }, CONSTANTS.UPGRADE_ERROR_TIMEOUT)
      return () => clearTimeout(timer)
    }
  }, [upgradeError])

  const userRole = getUserRole(activeOrganization, session?.user?.email)
  const isTeamAdmin = ['owner', 'admin'].includes(userRole)

  const permissions = getSubscriptionPermissions(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  const visiblePlans = getVisiblePlans(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    {
      isTeamAdmin,
      userRole: userRole || 'member',
    }
  )

  const showBadge =
    (permissions.canEditUsageLimit && !permissions.showTeamMemberView) ||
    permissions.showTeamMemberView ||
    subscription.isEnterprise ||
    isBlocked

  const getBadgeConfig = (): { text: string; variant: 'blue-secondary' | 'red' } => {
    if (permissions.showTeamMemberView || subscription.isEnterprise) {
      return { text: `${subscription.seats} seats`, variant: 'blue-secondary' }
    }
    if (isDispute) return { text: 'Get Help', variant: 'red' }
    if (isBlocked) return { text: 'Fix Now', variant: 'red' }
    if (subscription.isFree) return { text: 'Upgrade', variant: 'blue-secondary' }
    if (isCritical && permissions.canEditUsageLimit) {
      return { text: 'Increase Limit', variant: 'red' }
    }
    return { text: 'Increase Limit', variant: 'blue-secondary' }
  }
  const badgeConfig = getBadgeConfig()

  const handleUpgradeWithErrorHandling = useCallback(
    async (targetPlan: TargetPlan) => {
      try {
        await handleUpgrade(targetPlan)
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Unknown error occurred')
      }
    },
    [handleUpgrade]
  )

  const handleBadgeClick = useCallback(async () => {
    // Dispute: open help modal
    if (isDispute) {
      window.dispatchEvent(new CustomEvent('open-help-modal'))
      return
    }

    // Blocked: open billing portal
    if (isBlocked) {
      try {
        const context = subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'
        const res = await fetch('/api/billing/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context,
            organizationId: activeOrgId,
            returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || 'Failed to start billing portal')
        }
        window.location.href = data.url
      } catch (e) {
        logger.error('Failed to open billing portal', { error: e })
        alert(e instanceof Error ? e.message : 'Failed to open billing portal')
      }
      return
    }

    // Free: upgrade to pro
    if (subscription.isFree) {
      handleUpgradeWithErrorHandling('pro')
      return
    }

    // Paid: edit usage limit
    if (permissions.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }, [
    isDispute,
    isBlocked,
    subscription.isFree,
    subscription.isTeam,
    subscription.isEnterprise,
    activeOrgId,
    permissions.canEditUsageLimit,
    handleUpgradeWithErrorHandling,
    logger,
  ])

  const renderPlanCard = useCallback(
    (planType: 'pro' | 'team' | 'enterprise', options?: { horizontal?: boolean }) => {
      const handleContactEnterprise = () => window.open(CONSTANTS.TYPEFORM_ENTERPRISE_URL, '_blank')

      switch (planType) {
        case 'pro':
          return (
            <PlanCard
              key='pro'
              name='Pro'
              price={CONSTANTS.PRO_PRICE}
              priceSubtext='/month'
              features={PRO_PLAN_FEATURES}
              buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Pro'}
              onButtonClick={() => handleUpgradeWithErrorHandling('pro')}
              isError={upgradeError === 'pro'}
            />
          )

        case 'team':
          return (
            <PlanCard
              key='team'
              name='Team'
              price={CONSTANTS.TEAM_PRICE}
              priceSubtext='/month'
              features={TEAM_PLAN_FEATURES}
              buttonText={subscription.isFree ? 'Upgrade' : 'Upgrade to Team'}
              onButtonClick={() => handleUpgradeWithErrorHandling('team')}
              isError={upgradeError === 'team'}
            />
          )

        case 'enterprise':
          return (
            <PlanCard
              key='enterprise'
              name='Enterprise'
              price=''
              features={ENTERPRISE_PLAN_FEATURES}
              buttonText='Contact'
              onButtonClick={handleContactEnterprise}
              inlineButton={options?.horizontal}
            />
          )

        default:
          return null
      }
    },
    [subscription.isFree, upgradeError, handleUpgradeWithErrorHandling]
  )

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  return (
    <div className='flex h-full flex-col gap-[20px]'>
      {/* Current Plan & Usage Overview */}
      <UsageHeader
        title={formatPlanName(subscription.plan)}
        showBadge={showBadge}
        badgeText={badgeConfig.text}
        badgeVariant={badgeConfig.variant}
        onBadgeClick={permissions.showTeamMemberView ? undefined : handleBadgeClick}
        seatsText={
          permissions.canManageTeam || subscription.isEnterprise
            ? `${subscription.seats} seats`
            : undefined
        }
        current={usage.current}
        limit={
          subscription.isEnterprise || subscription.isTeam
            ? organizationBillingData?.data?.totalUsageLimit
            : !subscription.isFree &&
                (permissions.canEditUsageLimit || permissions.showTeamMemberView)
              ? usage.current // placeholder; rightContent will render UsageLimit
              : usage.limit
        }
        isBlocked={isBlocked}
        progressValue={Math.min(usage.percentUsed, 100)}
        rightContent={
          !subscription.isFree &&
          (permissions.canEditUsageLimit || permissions.showTeamMemberView) ? (
            <UsageLimit
              ref={usageLimitRef}
              currentLimit={
                (subscription.isTeam || subscription.isEnterprise) &&
                isTeamAdmin &&
                organizationBillingData?.data
                  ? organizationBillingData.data.totalUsageLimit
                  : usageLimitData.currentLimit || usage.limit
              }
              currentUsage={usage.current}
              canEdit={permissions.canEditUsageLimit}
              minimumLimit={
                (subscription.isTeam || subscription.isEnterprise) &&
                isTeamAdmin &&
                organizationBillingData?.data
                  ? organizationBillingData.data.minimumBillingAmount
                  : usageLimitData.minimumLimit || (subscription.isPro ? 20 : 40)
              }
              context={
                (subscription.isTeam || subscription.isEnterprise) && isTeamAdmin
                  ? 'organization'
                  : 'user'
              }
              organizationId={
                (subscription.isTeam || subscription.isEnterprise) && isTeamAdmin
                  ? activeOrgId
                  : undefined
              }
              onLimitUpdated={() => {
                logger.info('Usage limit updated')
              }}
            />
          ) : undefined
        }
      />

      {/* Upgrade Plans */}
      {permissions.showUpgradePlans && (
        <div className='flex flex-col gap-[10px]'>
          {/* Render plans based on what should be visible */}
          {(() => {
            const hasEnterprise = visiblePlans.includes('enterprise')
            const nonEnterprisePlans = visiblePlans.filter((plan) => plan !== 'enterprise')

            // Free users: Pro + Team in 2-col grid, Enterprise horizontal
            // Pro users: Team + Enterprise both vertical (single column)
            // Team admins: Enterprise only (horizontal)
            const showEnterpriseHorizontal =
              subscription.isFree || (subscription.isTeam && isTeamAdmin)

            return (
              <>
                {nonEnterprisePlans.length > 0 && (
                  <div
                    className={cn(
                      'grid gap-[10px]',
                      nonEnterprisePlans.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
                    )}
                  >
                    {nonEnterprisePlans.map((plan) => renderPlanCard(plan))}
                  </div>
                )}
                {hasEnterprise &&
                  renderPlanCard('enterprise', { horizontal: showEnterpriseHorizontal })}
              </>
            )
          })()}
        </div>
      )}

      {/* Credit Balance */}
      {subscription.isPaid && (
        <CreditBalance
          balance={subscriptionData?.data?.creditBalance ?? 0}
          canPurchase={permissions.canEditUsageLimit}
          entityType={subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user'}
          isLoading={isLoading}
          onPurchaseComplete={() => refetchSubscription()}
        />
      )}

      {/* Next Billing Date - hidden from team members */}
      {subscription.isPaid &&
        subscriptionData?.data?.periodEnd &&
        !permissions.showTeamMemberView && (
          <div className='flex items-center justify-between'>
            <Label>Next Billing Date</Label>
            <span className='text-[12px] text-[var(--text-secondary)]'>
              {new Date(subscriptionData.data.periodEnd).toLocaleDateString()}
            </span>
          </div>
        )}

      {/* Usage notifications */}
      {subscription.isPaid && <BillingUsageNotificationsToggle />}

      {/* Cancel Subscription */}
      {permissions.canCancelSubscription && (
        <CancelSubscription
          subscription={{
            plan: subscription.plan,
            status: subscription.status,
            isPaid: subscription.isPaid,
          }}
          subscriptionData={{
            periodEnd: subscriptionData?.data?.periodEnd || null,
            cancelAtPeriodEnd: subscriptionData?.data?.cancelAtPeriodEnd,
          }}
        />
      )}

      {/* Billed Account for Workspace - Only visible to team admins */}
      {!isLoading && isTeamAdmin && (
        <div className='mt-auto flex items-center justify-between'>
          <div className='flex items-center gap-[6px]'>
            <Label htmlFor='billed-account'>Billed Account</Label>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Info className='h-[12px] w-[12px] text-[var(--text-secondary)]' />
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span>Usage from this workspace will be billed to this account</span>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          {workspaceAdmins.length === 0 ? (
            <div className='rounded-[6px] border border-[var(--border)] border-dashed px-[12px] py-[6px] text-[12px] text-[var(--text-muted)]'>
              No admins available
            </div>
          ) : (
            <div className='w-[200px]'>
              <Combobox
                size='sm'
                align='end'
                dropdownWidth={200}
                value={billedAccountUserId || ''}
                onChange={async (value: string) => {
                  if (value && value !== billedAccountUserId) {
                    try {
                      await updateWorkspaceSettings({ billedAccountUserId: value })
                    } catch {
                      // Error is already logged in updateWorkspaceSettings
                    }
                  }
                }}
                disabled={!canManageWorkspaceKeys || updateWorkspaceMutation.isPending}
                placeholder='Select admin'
                options={workspaceAdmins.map((admin) => ({
                  label: admin.email,
                  value: admin.userId,
                }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BillingUsageNotificationsToggle() {
  const enabled = useBillingUsageNotifications()
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col gap-[4px]'>
        <Label htmlFor='usage-notifications'>Usage notifications</Label>
        <span className='text-[12px] text-[var(--text-muted)]'>
          Email me when I reach 80% usage
        </span>
      </div>
      <Switch
        id='usage-notifications'
        checked={!!enabled}
        disabled={isLoading}
        onCheckedChange={(v: boolean) => {
          if (v !== enabled) {
            updateSetting.mutate({ key: 'billingUsageNotificationsEnabled', value: v })
          }
        }}
      />
    </div>
  )
}
