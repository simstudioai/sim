'use client'

import { useCallback, useEffect, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Chip } from '@/components/emcn'
import {
  getUpgradeCardCta,
  type PlanCardCta,
  type PlanTier,
  type UpgradeCardId,
} from '@/lib/billing/client'
import { ANNUAL_DISCOUNT_RATE } from '@/lib/billing/constants'
import {
  getDisplayPlanName,
  getPlanTierCredits,
  getPlanTierDollars,
} from '@/lib/billing/plan-helpers'
import { UsageHeader } from '@/app/workspace/[workspaceId]/settings/components/usage-header/usage-header'
import { UsageLimit } from '@/app/workspace/[workspaceId]/settings/components/usage-limit'
import { isBillingEnabled } from '@/app/workspace/[workspaceId]/settings/navigation'
import {
  BillingPeriodToggle,
  BillingUsageNotificationsToggle,
  ComparisonTable,
  CreditBalance,
  ManagePlanModal,
  type PlanName,
  UpgradePlanCard,
} from '@/app/workspace/[workspaceId]/upgrade/components'
import { useUpgradeState } from '@/app/workspace/[workspaceId]/upgrade/hooks'
import {
  ENTERPRISE_PLAN_CREDITS,
  ENTERPRISE_PLAN_FEATURES,
  MAX_PLAN_CREDITS,
  MAX_PLAN_FEATURES,
  PRO_PLAN_CREDITS,
  PRO_PLAN_FEATURES,
} from '@/app/workspace/[workspaceId]/upgrade/plan-configs'
import { useFullscreenOriginStore } from '@/stores/fullscreen-origin'

const TYPEFORM_ENTERPRISE_URL = 'https://form.typeform.com/to/jqCO12pF' as const

/**
 * Props for {@link Upgrade}.
 */
export interface UpgradeProps {
  workspaceId: string
}

/**
 * Full-screen Upgrade page. Renders the plan cards, the billing-period toggle,
 * and the manage-plan modal on top of the derived state from
 * {@link useUpgradeState}. All usage and billing controls live inside
 * {@link ManagePlanModal} for paid customers.
 */
export function Upgrade({ workspaceId }: UpgradeProps) {
  const state = useUpgradeState()
  const router = useRouter()
  const origin = useFullscreenOriginStore((s) => s.origin)
  const [showAllFeatures, setShowAllFeatures] = useState(false)

  const handleBack = useCallback(() => {
    router.replace(origin ?? `/workspace/${workspaceId}/home`)
  }, [origin, router, workspaceId])

  const handleSelectPlan = useCallback(
    (plan: PlanName) => {
      if (plan === 'Enterprise') {
        window.open(TYPEFORM_ENTERPRISE_URL, '_blank')
      } else if (plan === 'Pro') {
        state.doUpgrade('pro', state.proTier.credits)
      } else if (plan === 'Max') {
        if (state.subscription.isPaid) state.upgradeOrSwitchToMax()
        else state.doUpgrade('pro', state.maxTier.credits)
      } else {
        handleBack()
      }
    },
    [handleBack, state]
  )

  // Enterprise manages billing out-of-band, and self-hosted deployments with
  // billing disabled have no plans to surface — redirect to home in both cases.
  useEffect(() => {
    if (!isBillingEnabled) {
      router.replace(`/workspace/${workspaceId}/home`)
      return
    }
    if (!state.isLoading && state.subscription.isEnterprise) {
      router.replace(`/workspace/${workspaceId}/home`)
    }
  }, [state.isLoading, state.subscription.isEnterprise, router, workspaceId])

  if (!isBillingEnabled || state.isLoading || state.subscription.isEnterprise) return null

  // Enterprise is redirected above, so the current plan is only ever free/pro/max here.
  const planTier: PlanTier = state.subscription.isFree ? 'free' : state.isOnMaxTier ? 'max' : 'pro'

  /**
   * Resolve a card's CTA from the canonical matrix, then bind it to the matching
   * handler. A same-tier "Manage plan" card flips to an interval switch when the
   * billing-period toggle differs from the active subscription interval.
   */
  const resolveCta = (card: UpgradeCardId): PlanCardCta & { onClick: () => void } => {
    const cta = getUpgradeCardCta(planTier, card)

    if (cta.intent === 'manage' && state.wantsIntervalSwitch) {
      return {
        ...cta,
        label: `Switch to ${state.isAnnual ? 'Annual' : 'Monthly'}`,
        onClick: () =>
          state
            .handleSwitchInterval(state.isAnnual ? 'year' : 'month')
            .catch((e) => alert(getErrorMessage(e, 'Failed to switch interval'))),
      }
    }

    const onClick = (): void => {
      switch (cta.intent) {
        case 'manage':
          state.setManagePlanModalOpen(true)
          return
        case 'sales':
          window.open(TYPEFORM_ENTERPRISE_URL, '_blank')
          return
        case 'downgrade':
          void state.onUpgradeToOtherTier()
          return
        case 'upgrade':
          if (card === 'max') {
            if (state.subscription.isPaid) void state.upgradeOrSwitchToMax()
            else state.doUpgrade('pro', state.maxTier.credits)
          } else {
            state.doUpgrade('pro', state.proTier.credits)
          }
      }
    }

    return { ...cta, onClick }
  }

  const proCta = resolveCta('pro')
  const maxCta = resolveCta('max')
  const enterpriseCta = resolveCta('enterprise')

  const proBanner = state.isOnPro ? 'Your plan' : undefined
  const maxBanner = state.isOnMax ? 'Your plan' : undefined

  const discountPct = Math.round(ANNUAL_DISCOUNT_RATE * 100)
  const proPrice = state.isAnnual
    ? Math.round(state.proTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : state.proTier.dollars
  const maxPrice = state.isAnnual
    ? Math.round(state.maxTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
    : state.maxTier.dollars
  const priceSubtext = state.isAnnual
    ? 'per user/month, billed annually'
    : 'per user/month, billed monthly'

  const organizationBilling = state.organizationBillingData?.data

  const usageHeaderCurrent =
    state.subscription.isOrgScoped && organizationBilling?.totalCurrentUsage != null
      ? organizationBilling.totalCurrentUsage
      : state.usage.current
  const usageHeaderLimit = state.subscription.isOrgScoped
    ? (organizationBilling?.totalUsageLimit ?? state.usage.limit)
    : !state.subscription.isFree &&
        (state.permissions.canEditUsageLimit || state.permissions.showTeamMemberView)
      ? state.usage.current
      : state.usage.limit

  const showUsageLimit =
    !state.subscription.isFree &&
    (state.permissions.canEditUsageLimit || state.permissions.showTeamMemberView)

  const isPaidWithUsage = state.subscription.isPaid && state.permissions.canViewUsageInfo
  const showStripeActions =
    state.subscription.isPaid &&
    !state.permissions.showTeamMemberView &&
    !state.permissions.isEnterpriseMember
  const showBilledAccount = state.isTeamAdmin && state.isGrandfatheredSharedWorkspace
  const showPeriodEnd =
    state.subscription.isPaid &&
    !!state.periodEnd &&
    !state.permissions.showTeamMemberView &&
    !state.permissions.isEnterpriseMember

  const billingDetailsUsageHeader = state.permissions.canViewUsageInfo ? (
    <UsageHeader
      title={getDisplayPlanName(state.subscription.plan)}
      showBadge={state.showBadge}
      badgeText={state.badgeConfig.text}
      badgeVariant={state.badgeConfig.variant}
      onBadgeClick={state.permissions.showTeamMemberView ? undefined : state.handleBadgeClick}
      seatsText={
        state.permissions.canManageTeam || state.subscription.isEnterprise
          ? `${state.subscription.seats} Seats`
          : undefined
      }
      onDemandState={state.onDemandState}
      onToggleOnDemand={
        state.onDemandState === 'enable'
          ? state.handleToggleOnDemand
          : state.onDemandState === 'disable' && state.canDisableOnDemand
            ? state.handleToggleOnDemand
            : undefined
      }
      current={usageHeaderCurrent}
      limit={usageHeaderLimit}
      isBlocked={state.isBlocked}
      progressValue={Math.min(state.usage.percentUsed, 100)}
      rightContent={
        showUsageLimit ? (
          <UsageLimit
            ref={state.usageLimitRef}
            currentLimit={
              state.subscription.isOrgScoped && state.isTeamAdmin && organizationBilling
                ? organizationBilling.totalUsageLimit
                : state.usageLimitData.currentLimit || state.usage.limit
            }
            currentUsage={state.usage.current}
            canEdit={state.permissions.canEditUsageLimit}
            minimumLimit={
              state.subscription.isOrgScoped && state.isTeamAdmin && organizationBilling
                ? organizationBilling.minimumBillingAmount
                : state.usageLimitData.minimumLimit
            }
            context={state.shouldUseOrganizationBillingContext ? 'organization' : 'user'}
            organizationId={
              state.shouldUseOrganizationBillingContext
                ? (state.billingOrganizationId ?? undefined)
                : undefined
            }
          />
        ) : undefined
      }
    />
  ) : (
    <div className='flex items-center'>
      <span className='font-medium text-[var(--text-primary)] text-base'>
        {getDisplayPlanName(state.subscription.plan)}
      </span>
    </div>
  )

  const billingDetailsCreditBalance =
    isPaidWithUsage && !state.subscription.isEnterprise ? (
      <CreditBalance
        balance={state.creditBalance}
        canPurchase={state.hasUsablePaidAccess && state.permissions.canEditUsageLimit}
        entityType={state.subscription.isOrgScoped ? 'organization' : 'user'}
        isLoading={state.isLoading}
        onPurchaseComplete={state.refetchSubscription}
      />
    ) : undefined

  const billingDetailsNotifications = isPaidWithUsage ? (
    <BillingUsageNotificationsToggle />
  ) : undefined

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <Chip variant='ghost' leftIcon={ArrowLeft} onClick={handleBack}>
          Back
        </Chip>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex w-full max-w-[960px] flex-col gap-7 pt-6 pb-3'>
          <div className='flex flex-col items-center gap-4'>
            <h1 className='text-balance text-center font-season text-[30px] text-[var(--text-primary)]'>
              Plans that scale with you
            </h1>
            {state.showUpgradePlans && (
              <BillingPeriodToggle isAnnual={state.isAnnual} onChange={state.setIsAnnual} />
            )}
          </div>

          {state.showUpgradePlans && (
            <>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
                <UpgradePlanCard
                  name='Pro'
                  price={`$${proPrice}`}
                  discountLabel={state.isAnnual ? `${discountPct}% off` : undefined}
                  priceSubtext={priceSubtext}
                  segmentLabel='For growing teams'
                  credits={PRO_PLAN_CREDITS.credits}
                  refresh={PRO_PLAN_CREDITS.refresh}
                  features={PRO_PLAN_FEATURES}
                  buttonText={proCta.label}
                  onButtonClick={proCta.onClick}
                  highlighted={proCta.variant === 'primary'}
                  bannerText={proBanner}
                />

                <UpgradePlanCard
                  name='Max'
                  price={`$${maxPrice}`}
                  discountLabel={state.isAnnual ? `${discountPct}% off` : undefined}
                  priceSubtext={priceSubtext}
                  segmentLabel='For scaling businesses'
                  credits={MAX_PLAN_CREDITS.credits}
                  refresh={MAX_PLAN_CREDITS.refresh}
                  features={MAX_PLAN_FEATURES}
                  buttonText={maxCta.label}
                  onButtonClick={maxCta.onClick}
                  highlighted={maxCta.variant === 'primary'}
                  bannerText={maxBanner}
                />

                <UpgradePlanCard
                  name='Enterprise'
                  price='Custom'
                  segmentLabel='For large organizations'
                  credits={ENTERPRISE_PLAN_CREDITS.credits}
                  refresh={ENTERPRISE_PLAN_CREDITS.refresh}
                  features={ENTERPRISE_PLAN_FEATURES}
                  buttonText={enterpriseCta.label}
                  onButtonClick={enterpriseCta.onClick}
                  highlighted={enterpriseCta.variant === 'primary'}
                />
              </div>

              {/* Show / Hide all features */}
              <div className='flex flex-col items-center gap-6'>
                <Chip
                  variant='ghost'
                  onClick={() => setShowAllFeatures((prev) => !prev)}
                  aria-expanded={showAllFeatures}
                >
                  {showAllFeatures ? 'Hide all features' : 'Show all features'}
                </Chip>

                {showAllFeatures && (
                  <ComparisonTable
                    proPrice={`$${proPrice}`}
                    maxPrice={`$${maxPrice}`}
                    isAnnual={state.isAnnual}
                    onIsAnnualChange={state.setIsAnnual}
                    onSelectPlan={handleSelectPlan}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ManagePlanModal
        open={state.managePlanModalOpen}
        onOpenChange={state.setManagePlanModalOpen}
        currentPlanCredits={getPlanTierCredits(state.subscription.plan)}
        currentPlanDollars={getPlanTierDollars(state.subscription.plan)}
        currentInterval={state.currentInterval}
        isTeamPlan={state.subscription.isTeam}
        isCancelledAtPeriodEnd={state.isCancelledAtPeriodEnd}
        isLegacyPlan={state.isLegacyPlan}
        onSwitchInterval={async (interval) => {
          await state.handleSwitchInterval(interval)
          state.setManagePlanModalOpen(false)
        }}
        onUpgradeToOtherTier={state.onUpgradeToOtherTier}
        onUpgradeToCurrentTier={state.onUpgradeToCurrentTier}
        onCancel={state.onCancel}
        onRestore={state.onRestore}
        billingDetails={
          state.subscription.isPaid || state.isTeamAdmin
            ? {
                usageHeader: billingDetailsUsageHeader,
                creditBalance: billingDetailsCreditBalance,
                notificationsToggle: billingDetailsNotifications,
                periodEnd: showPeriodEnd ? state.periodEnd : null,
                isCancelledAtPeriodEnd: state.isCancelledAtPeriodEnd,
                showStripeActions,
                isBillingPortalPending: state.isBillingPortalPending,
                onOpenBillingPortal: state.openBillingPortalWindow,
                showBilledAccount,
                workspaceAdmins: state.workspaceAdmins.map((a) => ({
                  userId: a.userId,
                  email: a.email,
                })),
                billedAccountUserId: state.billedAccountUserId,
                canManageWorkspaceKeys: state.canManageWorkspaceKeys,
                isUpdatingWorkspace: state.isUpdatingWorkspace,
                onChangeBilledAccount: async (userId: string) => {
                  await state.updateWorkspaceSettings({ billedAccountUserId: userId })
                },
              }
            : undefined
        }
      />
    </div>
  )
}
