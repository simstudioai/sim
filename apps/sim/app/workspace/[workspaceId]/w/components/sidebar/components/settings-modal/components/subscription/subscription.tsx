'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Switch } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSession } from '@/lib/auth/auth-client'
import { useSubscriptionUpgrade } from '@/lib/billing/client/upgrade'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserRole } from '@/lib/workspaces/organization/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { UsageHeader } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/shared/usage-header'
import {
  CancelSubscription,
  CreditBalance,
  PlanCard,
  UsageLimit,
  type UsageLimitRef,
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
import { useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData, useUsageLimitData } from '@/hooks/queries/subscription'
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/queries/workspace'
import { useGeneralStore } from '@/stores/settings/general/store'

const CONSTANTS = {
  UPGRADE_ERROR_TIMEOUT: 3000, // 3 seconds
  TYPEFORM_ENTERPRISE_URL: 'https://form.typeform.com/to/jqCO12pF',
  PRO_PRICE: '$20',
  TEAM_PRICE: '$40',
  INITIAL_TEAM_SEATS: 1,
} as const

type TargetPlan = 'pro' | 'team'

/**
 * Skeleton component for subscription loading state.
 */
function SubscriptionSkeleton() {
  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* Current Plan & Usage Header */}
      <div>
        <div className='rounded-[8px] border bg-[var(--surface-3)] p-3 shadow-xs'>
          <div className='space-y-[8px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[8px]'>
                <Skeleton className='h-5 w-16' />
                <Skeleton className='h-[1.125rem] w-14 rounded-[6px]' />
              </div>
              <div className='flex items-center gap-[4px]'>
                <Skeleton className='h-4 w-12' />
                <span className='text-[var(--text-muted)] text-xs'>/</span>
                <Skeleton className='h-4 w-12' />
              </div>
            </div>
            <Skeleton className='h-2 w-full rounded' />
          </div>
        </div>
      </div>

      {/* Plan Cards */}
      <div className='flex flex-col gap-[8px]'>
        {/* Pro and Team Cards Grid */}
        <div className='grid grid-cols-2 gap-[8px]'>
          {/* Pro Plan Card */}
          <div className='flex flex-col rounded-[8px] border p-4'>
            <div className='mb-[16px]'>
              <Skeleton className='mb-[8px] h-5 w-10' />
              <div className='flex items-baseline gap-[4px]'>
                <Skeleton className='h-6 w-12' />
                <Skeleton className='h-3 w-14' />
              </div>
            </div>
            <div className='mb-[16px] flex-1 space-y-[8px]'>
              {[...Array(4)].map((_, i) => (
                <div key={i} className='flex items-start gap-[8px]'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded-full' />
                  <Skeleton className='h-3 w-24' />
                </div>
              ))}
            </div>
            <Skeleton className='h-9 w-full rounded-[8px]' />
          </div>

          {/* Team Plan Card */}
          <div className='flex flex-col rounded-[8px] border p-4'>
            <div className='mb-[16px]'>
              <Skeleton className='mb-[8px] h-5 w-12' />
              <div className='flex items-baseline gap-[4px]'>
                <Skeleton className='h-6 w-12' />
                <Skeleton className='h-3 w-14' />
              </div>
            </div>
            <div className='mb-[16px] flex-1 space-y-[8px]'>
              {[...Array(4)].map((_, i) => (
                <div key={i} className='flex items-start gap-[8px]'>
                  <Skeleton className='mt-0.5 h-3 w-3 rounded-full' />
                  <Skeleton className='h-3 w-28' />
                </div>
              ))}
            </div>
            <Skeleton className='h-9 w-full rounded-[8px]' />
          </div>
        </div>

        {/* Enterprise Card - Horizontal Layout */}
        <div className='flex items-center justify-between rounded-[8px] border p-4'>
          <div className='flex-1'>
            <Skeleton className='mb-[8px] h-5 w-24' />
            <Skeleton className='mb-[12px] h-3 w-80' />
            <div className='flex items-center gap-[16px]'>
              {[...Array(3)].map((_, i) => (
                <div key={i} className='flex items-center gap-[8px]'>
                  <Skeleton className='h-3 w-3 rounded-full' />
                  <Skeleton className='h-3 w-20' />
                  {i < 2 && <div className='ml-[8px] h-4 w-px bg-[var(--border)]' />}
                </div>
              ))}
            </div>
          </div>
          <Skeleton className='h-9 w-20 rounded-[8px]' />
        </div>
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

  const isLoading = isSubscriptionLoading || isUsageLimitLoading || isWorkspaceLoading

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
    seats: organizationBillingData?.totalSeats ?? 0,
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

  const billingStatus = subscriptionData?.data?.billingBlocked ? 'blocked' : 'ok'

  const billedAccountUserId = workspaceData?.settings?.workspace?.billedAccountUserId ?? null
  const workspaceAdmins =
    workspaceData?.permissions?.users?.filter((user: any) => user.permissionType === 'admin') || []

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

  // UI state computed values
  const showBadge = permissions.canEditUsageLimit && !permissions.showTeamMemberView
  const badgeText = subscription.isFree ? 'Upgrade' : 'Increase Limit'

  const handleBadgeClick = () => {
    if (subscription.isFree) {
      handleUpgrade('pro')
    } else if (permissions.canEditUsageLimit && usageLimitRef.current) {
      usageLimitRef.current.startEdit()
    }
  }

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

  const renderPlanCard = useCallback(
    (planType: 'pro' | 'team' | 'enterprise', layout: 'vertical' | 'horizontal' = 'vertical') => {
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
              layout={layout}
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
              layout={layout}
            />
          )

        case 'enterprise':
          return (
            <PlanCard
              key='enterprise'
              name='Enterprise'
              price={<span className='font-semibold text-xl'>Custom</span>}
              priceSubtext={
                layout === 'horizontal'
                  ? 'Custom solutions tailored to your enterprise needs'
                  : undefined
              }
              features={ENTERPRISE_PLAN_FEATURES}
              buttonText='Contact'
              onButtonClick={handleContactEnterprise}
              layout={layout}
            />
          )

        default:
          return null
      }
    },
    [subscription.isFree, upgradeError, handleUpgrade]
  )

  if (isLoading) {
    return <SubscriptionSkeleton />
  }

  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* Current Plan & Usage Overview */}
      <div>
        <UsageHeader
          title={formatPlanName(subscription.plan)}
          gradientTitle={!subscription.isFree}
          showBadge={showBadge}
          badgeText={badgeText}
          onBadgeClick={handleBadgeClick}
          seatsText={
            permissions.canManageTeam || subscription.isEnterprise
              ? `${subscription.seats} seats`
              : undefined
          }
          current={
            subscription.isEnterprise || subscription.isTeam
              ? (organizationBillingData?.totalCurrentUsage ?? usage.current)
              : usage.current
          }
          limit={
            subscription.isEnterprise || subscription.isTeam
              ? organizationBillingData?.totalUsageLimit ||
                organizationBillingData?.minimumBillingAmount ||
                usage.limit
              : !subscription.isFree &&
                  (permissions.canEditUsageLimit || permissions.showTeamMemberView)
                ? usage.current // placeholder; rightContent will render UsageLimit
                : usage.limit
          }
          isBlocked={Boolean(subscriptionData?.data?.billingBlocked)}
          blockedReason={subscriptionData?.data?.billingBlockedReason}
          blockedByOrgOwner={Boolean(subscriptionData?.data?.blockedByOrgOwner)}
          status={billingStatus}
          percentUsed={
            subscription.isEnterprise || subscription.isTeam
              ? organizationBillingData?.totalUsageLimit &&
                organizationBillingData.totalUsageLimit > 0 &&
                organizationBillingData.totalCurrentUsage !== undefined
                ? (organizationBillingData.totalCurrentUsage /
                    organizationBillingData.totalUsageLimit) *
                  100
                : usage.percentUsed
              : usage.percentUsed
          }
          onContactSupport={() => {
            window.dispatchEvent(new CustomEvent('open-help-modal'))
          }}
          onResolvePayment={async () => {
            try {
              const res = await fetch('/api/billing/portal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  context:
                    subscription.isTeam || subscription.isEnterprise ? 'organization' : 'user',
                  organizationId: activeOrgId,
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
            !subscription.isFree &&
            (permissions.canEditUsageLimit || permissions.showTeamMemberView) ? (
              <UsageLimit
                ref={usageLimitRef}
                currentLimit={
                  subscription.isTeam && isTeamAdmin
                    ? organizationBillingData?.totalUsageLimit || usage.limit
                    : usageLimitData.currentLimit || usage.limit
                }
                currentUsage={usage.current}
                canEdit={permissions.canEditUsageLimit}
                minimumLimit={
                  subscription.isTeam && isTeamAdmin
                    ? organizationBillingData?.minimumBillingAmount ||
                      (subscription.isPro ? 20 : 40)
                    : usageLimitData.minimumLimit || (subscription.isPro ? 20 : 40)
                }
                context={subscription.isTeam && isTeamAdmin ? 'organization' : 'user'}
                organizationId={subscription.isTeam && isTeamAdmin ? activeOrgId : undefined}
                onLimitUpdated={() => {
                  logger.info('Usage limit updated')
                }}
              />
            ) : undefined
          }
          progressValue={Math.min(usage.percentUsed, 100)}
        />
      </div>

      {/* Enterprise Usage Limit Notice */}
      {subscription.isEnterprise && (
        <div className='text-center'>
          <p className='text-[var(--text-muted)] text-xs'>
            Contact enterprise for support usage limit changes
          </p>
        </div>
      )}

      {/* Team Member Notice */}
      {permissions.showTeamMemberView && (
        <div className='text-center'>
          <p className='text-[var(--text-muted)] text-xs'>
            Contact your team admin to increase limits
          </p>
        </div>
      )}

      {/* Upgrade Plans */}
      {permissions.showUpgradePlans && (
        <div className='flex flex-col gap-[8px]'>
          {/* Render plans based on what should be visible */}
          {(() => {
            const totalPlans = visiblePlans.length
            const hasEnterprise = visiblePlans.includes('enterprise')

            // Special handling for Pro users - show team and enterprise side by side
            if (subscription.isPro && totalPlans === 2) {
              return (
                <div className='grid grid-cols-2 gap-[8px]'>
                  {visiblePlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                </div>
              )
            }

            // Default behavior for other users
            const otherPlans = visiblePlans.filter((p) => p !== 'enterprise')

            // Layout logic:
            // Free users (3 plans): Pro and Team vertical in grid, Enterprise horizontal below
            // Team admins (1 plan): Enterprise horizontal
            const enterpriseLayout =
              totalPlans === 1 || totalPlans === 3 ? 'horizontal' : 'vertical'

            return (
              <>
                {otherPlans.length > 0 && (
                  <div
                    className={cn(
                      'grid gap-[8px]',
                      otherPlans.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    )}
                  >
                    {otherPlans.map((plan) => renderPlanCard(plan, 'vertical'))}
                  </div>
                )}

                {/* Enterprise plan */}
                {hasEnterprise && renderPlanCard('enterprise', enterpriseLayout)}
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

      {/* Next Billing Date */}
      {subscription.isPaid && subscriptionData?.data?.periodEnd && (
        <div className='flex items-center justify-between'>
          <span className='font-medium text-[13px]'>Next Billing Date</span>
          <span className='text-[13px] text-[var(--text-muted)]'>
            {new Date(subscriptionData.data.periodEnd).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Billing usage notifications toggle */}
      {subscription.isPaid && <BillingUsageNotificationsToggle />}

      {/* Cancel Subscription */}
      {permissions.canCancelSubscription && (
        <div className='mt-[8px]'>
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
        </div>
      )}

      {/* Workspace API Billing Settings */}
      {canManageWorkspaceKeys && (
        <div className='mt-[24px] flex items-center justify-between'>
          <span className='font-medium text-[13px]'>Billed Account for Workspace</span>
          {isWorkspaceLoading ? (
            <Skeleton className='h-8 w-[200px] rounded-[6px]' />
          ) : workspaceAdmins.length === 0 ? (
            <div className='rounded-[6px] border border-dashed px-3 py-1.5 text-[var(--text-muted)] text-xs'>
              No admin members available
            </div>
          ) : (
            <Select
              value={billedAccountUserId ?? ''}
              onValueChange={async (value) => {
                if (value === billedAccountUserId) return
                try {
                  await updateWorkspaceSettings({ billedAccountUserId: value })
                } catch (error) {
                  // Error is already logged in updateWorkspaceSettings
                }
              }}
              disabled={!canManageWorkspaceKeys || updateWorkspaceMutation.isPending}
            >
              <SelectTrigger className='h-8 w-[200px] justify-between text-left text-xs'>
                <SelectValue placeholder='Select admin' />
              </SelectTrigger>
              <SelectContent align='start' className='z-[10000050]'>
                <SelectGroup>
                  <SelectLabel className='px-3 py-1 text-[11px] text-[var(--text-muted)] uppercase'>
                    Workspace admins
                  </SelectLabel>
                  {workspaceAdmins.map((admin: any) => (
                    <SelectItem key={admin.userId} value={admin.userId} className='py-1 text-xs'>
                      {admin.email}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  )
}

function BillingUsageNotificationsToggle() {
  const enabled = useGeneralStore((s) => s.isBillingUsageNotificationsEnabled)
  const updateSetting = useUpdateGeneralSetting()
  const isLoading = updateSetting.isPending

  return (
    <div className='flex items-center justify-between'>
      <div className='flex flex-col'>
        <span className='font-medium text-[13px]'>Usage notifications</span>
        <span className='text-[var(--text-muted)] text-xs'>Email me when I reach 80% usage</span>
      </div>
      <Switch
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
