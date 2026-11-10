'use client'
import {
  ArrowRight,
  Badge,
  Chip,
  ChipLink,
  Credit,
  chipVariants,
  cn,
  Label,
  OverflowText,
  Switch,
  Tooltip,
  toast,
} from '@sim/emcn-legacy'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import { SettingsQueryErrorState } from '@/components/settings/primitives/settings-empty-state'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'
import { RESOURCE_ROW_ARROW_CLASSES } from '@/components/settings/primitives/settings-resource-row'
import { SettingsSection } from '@/components/settings/primitives/settings-section/settings-section'
import { AwsMarketplaceSubscriptionSection } from '@/components/settings/sections/billing/components/aws-marketplace-subscription-section/aws-marketplace-subscription-section'
import { CreditUsageSection } from '@/components/settings/sections/billing/components/credit-usage-section/credit-usage-section'
import { UsageLimitField } from '@/components/settings/sections/billing/components/usage-limit-field/usage-limit-field'
import { useSession, useSubscription } from '@/lib/auth/client'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER, formatCreditCost } from '@/lib/billing/credits/conversion'
import { formatInvoiceAmount, getInvoiceStatusBadge } from '@/lib/billing/invoices'
import {
  getCoveredUsage,
  getIsOnDemandActive,
  getOnDemandOffLimit,
  isOnDemandOffDisabled,
} from '@/lib/billing/on-demand'
import {
  getDisplayPlanName,
  getPlanTierCredits,
  getPlanTierDollars,
  getPlanWeeklyRefreshDollars,
  isEnterprise,
  isFree,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import { getSubscriptionPermissions } from '@/lib/billing/subscription-permissions'
import {
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
} from '@/lib/billing/subscriptions/utils'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useAwsMarketplaceBilling } from '@/hooks/queries/aws-marketplace'
import {
  useBillingUsageNotifications,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'
import {
  useInvoices,
  useOpenBillingPortal,
  useSubscriptionData,
  useUpdateUsageLimit,
} from '@/hooks/queries/subscription'

const logger = createLogger('Billing')

/** The signed-in user's personal plan, usage, and invoices. */
export function Billing() {
  const router = useRouter()

  const {
    data: subscriptionData,
    error: billingError,
    isFetchedAfterMount,
    isFetching,
    isLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData()
  const marketplaceBilling = useAwsMarketplaceBilling(null)
  const { billedThroughMarketplace } = marketplaceBilling

  const updateUserLimit = useUpdateUsageLimit()

  const billingUsageNotificationsEnabled = useBillingUsageNotifications()
  const updateGeneralSetting = useUpdateGeneralSetting()

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const openBillingPortal = useOpenBillingPortal()

  const upgradeWorkspaceId = subscriptionData?.data?.upgradeWorkspaceId
  const upgradeHref = upgradeWorkspaceId ? buildUpgradeHref() : null
  const prefetchUpgrade = () => {
    if (upgradeHref) router.prefetch(upgradeHref)
  }

  const plan = subscriptionData?.data?.plan ?? 'free'
  const status = subscriptionData?.data?.status ?? 'inactive'

  const subscription = {
    isFree: isFree(plan),
    isPro: isPro(plan),
    isTeam: isTeam(plan),
    isEnterprise: isEnterprise(plan),
    isPaid: isPaid(plan) && hasPaidSubscriptionStatus(status),
    plan,
    status,
  }

  const usage = {
    current: subscriptionData?.data?.usage?.current ?? 0,
    limit: subscriptionData?.data?.usage?.limit ?? 0,
  }

  const isBlocked = Boolean(subscriptionData?.data?.billingBlocked)

  /**
   * Invoice lookup is safe to start with the payer query: the endpoint returns an empty list
   * when the payer has no Stripe customer. Waiting to derive `isFree` serialized two independent
   * requests for every paid account.
   */
  const { data: invoicesData } = useInvoices({ context: 'user' })

  const planIncludedAmount = getPlanTierCredits(subscription.plan) / CREDIT_MULTIPLIER
  const effectiveUsageLimit = usage.limit
  const effectiveCurrentUsage = usage.current

  /**
   * Goodwill credits are already baked into the usage limit by
   * `setUsageLimitForCredits` (limit = planBase + creditBalance). `covered` is
   * that same never-billed ceiling, so on-demand is "on" only when the limit is
   * raised above it — a credit grant alone must not read as on-demand.
   */
  const creditBalance = subscriptionData?.data?.creditBalance ?? 0
  const covered = getCoveredUsage(planIncludedAmount, creditBalance)

  const isOnDemandActive = getIsOnDemandActive({
    isPaid: subscription.isPaid,
    planIncludedAmount,
    effectiveUsageLimit,
    covered,
  })

  /**
   * When usage already sits above `covered`, turning on-demand off would re-cap
   * the limit at current usage and the switch would bounce straight back on
   * (see `getOnDemandOffLimit`). Disable it and explain why via tooltip instead
   * of accepting a no-op click; it re-enables once usage drops back to/below
   * covered (e.g. the next billing reset).
   */
  const onDemandLockedOn = isOnDemandOffDisabled({
    isOnDemandActive,
    effectiveCurrentUsage,
    covered,
  })

  const permissions = getSubscriptionPermissions(
    {
      isFree: subscription.isFree,
      isPro: subscription.isPro,
      isTeam: subscription.isTeam,
      isEnterprise: subscription.isEnterprise,
      isPaid: subscription.isPaid,
      isOrgScoped: false,
      plan: subscription.plan,
      status: subscription.status,
    },
    { isTeamAdmin: true, userRole: 'owner' }
  )

  const hasUsablePaidAccess = subscription.isPaid
    ? hasUsableSubscriptionAccess(subscription.status, isBlocked)
    : false

  const isTogglingOnDemand = updateUserLimit.isPending

  const handleToggleOnDemand = async () => {
    if (!permissions.canEditUsageLimit) {
      toast.error("Can't change on-demand usage", {
        description: 'Only organization admins can change on-demand usage.',
      })
      return
    }

    try {
      const nextLimit = isOnDemandActive
        ? getOnDemandOffLimit(effectiveCurrentUsage, covered)
        : ON_DEMAND_UNLIMITED
      await updateUserLimit.mutateAsync({ limit: nextLimit })
    } catch (error) {
      logger.error('Failed to toggle on-demand billing', { error })
      toast.error("Couldn't update on-demand usage", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const handleOpenBillingPortal = () => {
    if (!permissions.canEditUsageLimit) {
      toast.error("Can't manage payment method", {
        description: 'Only organization admins can manage billing.',
      })
      return
    }
    openBillingPortal.open({ context: 'user', returnUrl: window.location.href }, (error) => {
      logger.error('Failed to open billing portal', { error })
      toast.error("Couldn't open billing portal", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    })
  }

  const handleCancelSubscription = async () => {
    if (!permissions.canEditUsageLimit) {
      toast.error("Can't cancel subscription", {
        description: 'Only organization admins can cancel the subscription.',
      })
      return
    }
    if (!betterAuthSubscription.cancel) return
    try {
      const returnUrl = getBaseUrl() + window.location.pathname
      await betterAuthSubscription.cancel({
        returnUrl,
        referenceId: session?.user?.id || '',
      })
    } catch (error) {
      logger.error('Failed to cancel subscription', { error })
      toast.error("Couldn't cancel subscription", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const handleRestoreSubscription = async () => {
    if (!permissions.canEditUsageLimit) {
      toast.error("Can't restore subscription", {
        description: 'Only organization admins can restore the subscription.',
      })
      return
    }
    if (!betterAuthSubscription.restore) return
    try {
      await betterAuthSubscription.restore({ referenceId: session?.user?.id || '' })
      await refetchSubscription()
    } catch (error) {
      logger.error('Failed to restore subscription', { error })
      toast.error("Couldn't restore subscription", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  if (isLoading && !isFetchedAfterMount) return null
  if (!subscriptionData?.data) {
    return (
      <SettingsPanel>
        <SettingsQueryErrorState
          error={billingError}
          fallback='Failed to load billing information'
          isRetrying={isFetching}
          onRetry={() => void refetchSubscription()}
        />
      </SettingsPanel>
    )
  }

  const planName = getDisplayPlanName(subscription.plan)
  const billingPeriod =
    subscriptionData.data.billingInterval === 'year' ? 'billed annually' : 'billed monthly'
  const planTitle = `Personal ${planName} plan`
  const priceText = billedThroughMarketplace
    ? subscription.isFree
      ? 'AWS Marketplace setup in progress'
      : 'Billed through AWS Marketplace'
    : subscription.isEnterprise
      ? 'Custom pricing'
      : `$${getPlanTierDollars(subscription.plan)} per user/month, ${billingPeriod}`

  const periodEnd = subscriptionData.data.periodEnd ?? null
  const isCancelledAtPeriodEnd = subscriptionData.data.cancelAtPeriodEnd === true

  const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(subscription.plan)

  const invoices = (invoicesData?.invoices ?? []).map((invoice) => ({
    id: invoice.id,
    date: formatDate(new Date(invoice.created * 1000)),
    amount: formatInvoiceAmount(invoice.total, invoice.currency),
    description: invoice.description,
    badge: getInvoiceStatusBadge(invoice.status),
    url: invoice.hostedInvoiceUrl ?? invoice.invoicePdf,
  }))

  const canManageBilling = permissions.canEditUsageLimit
  const canExplorePlans = permissions.showUpgradePlans
  const showUsageLimit = subscription.isPaid && !subscription.isEnterprise
  const showOnDemand = hasUsablePaidAccess && !subscription.isEnterprise

  const explorePlansLabel = 'Explore personal plans'

  return (
    <SettingsPanel>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2.5'>
          <div className='size-9 shrink-0'>
            <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
              <Credit className='size-5 text-[var(--text-icon)]' />
            </div>
          </div>
          <div className='flex min-w-0 flex-col'>
            <OverflowText label={planTitle} className='text-[var(--text-body)] text-sm' />
            <OverflowText label={priceText} className='text-[var(--text-muted)] text-caption' />
          </div>
        </div>
        {!subscription.isEnterprise &&
          marketplaceBilling.isResolved &&
          !billedThroughMarketplace &&
          (canExplorePlans && upgradeHref ? (
            <ChipLink
              href={upgradeHref}
              variant='border-shadow'
              onMouseEnter={prefetchUpgrade}
              onFocus={prefetchUpgrade}
            >
              {explorePlansLabel}
            </ChipLink>
          ) : (
            <Chip variant='border-shadow' disabled>
              {explorePlansLabel}
            </Chip>
          ))}
      </div>

      {showUsageLimit && (
        <UsageLimitField
          currentLimit={usage.limit}
          minimumLimit={getPlanTierDollars(subscription.plan)}
          canEdit={permissions.canEditUsageLimit}
          context='user'
        />
      )}

      {showOnDemand && (
        <SettingsSection label='Enable on-demand usage'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='on-demand-usage'>Allow usage to go past included usage</Label>
            {onDemandLockedOn ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Switch
                      id='on-demand-usage'
                      checked
                      disabled
                      onCheckedChange={handleToggleOnDemand}
                    />
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content className='max-w-[260px]'>
                  <p>
                    {
                      "Your usage is above your plan's included amount, so on-demand can't be turned off yet. It turns off once usage drops below it — at the latest when your billing period resets."
                    }
                  </p>
                </Tooltip.Content>
              </Tooltip.Root>
            ) : (
              <Switch
                id='on-demand-usage'
                checked={isOnDemandActive}
                disabled={isTogglingOnDemand || !canManageBilling}
                onCheckedChange={handleToggleOnDemand}
              />
            )}
          </div>
        </SettingsSection>
      )}

      {!subscription.isFree && !subscription.isEnterprise && (
        <SettingsSection label='Usage notifications'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='usage-notifications'>Email me when I reach 80% usage</Label>
            <Switch
              id='usage-notifications'
              checked={!!billingUsageNotificationsEnabled}
              disabled={updateGeneralSetting.isPending}
              onCheckedChange={(value: boolean) => {
                if (value !== billingUsageNotificationsEnabled) {
                  updateGeneralSetting.mutate({
                    key: 'billingUsageNotificationsEnabled',
                    value,
                  })
                }
              }}
            />
          </div>
        </SettingsSection>
      )}

      {(subscription.isPaid || subscription.isEnterprise) && (
        <SettingsSection label='Subscription'>
          <div className='flex flex-col gap-4'>
            {periodEnd && (
              <div className='flex items-center justify-between'>
                <span className='text-[var(--text-body)] text-small'>
                  {isCancelledAtPeriodEnd ? 'Access until' : 'Next billing date'}
                </span>
                <span className='text-[var(--text-muted)] text-small'>
                  {new Date(periodEnd).toLocaleDateString()}
                </span>
              </div>
            )}

            {subscription.isPaid && weeklyRefreshDollars > 0 && (
              <div className='flex items-center justify-between'>
                <span className='text-[var(--text-body)] text-small'>Weekly refresh</span>
                <span className='text-[var(--text-muted)] text-small'>
                  +{formatCreditCost(weeklyRefreshDollars)}
                </span>
              </div>
            )}

            <div className='flex items-center justify-between'>
              <span className='text-[var(--text-body)] text-small'>Payment method</span>
              <Chip
                disabled={!canManageBilling || openBillingPortal.isPending}
                onClick={handleOpenBillingPortal}
              >
                Manage in Stripe
              </Chip>
            </div>

            {!subscription.isEnterprise && (
              <div className='flex items-center justify-between'>
                <span className='text-[var(--text-body)] text-small'>
                  {isCancelledAtPeriodEnd ? 'Subscription canceled' : 'Cancel subscription'}
                </span>
                {isCancelledAtPeriodEnd ? (
                  <Chip
                    variant='primary'
                    disabled={!canManageBilling}
                    onClick={handleRestoreSubscription}
                  >
                    Restore
                  </Chip>
                ) : (
                  <Chip
                    variant='destructive'
                    disabled={!canManageBilling}
                    onClick={handleCancelSubscription}
                  >
                    Cancel
                  </Chip>
                )}
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      <AwsMarketplaceSubscriptionSection organizationId={null} />

      {!subscription.isFree && invoices.length > 0 && (
        <SettingsSection label='Invoices'>
          <div className='-mx-2 flex flex-col gap-y-0.5'>
            {invoices.map((invoice) => {
              const rowClassName =
                'flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors'
              const rowContent = (
                <>
                  <span className='shrink-0 text-[var(--text-body)] text-sm'>{invoice.date}</span>
                  <Badge variant={invoice.badge.variant} size='sm'>
                    {invoice.badge.label}
                  </Badge>
                  <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                    {invoice.amount}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-[var(--text-muted)] text-caption'>
                    {invoice.description ?? ''}
                  </span>
                  <ArrowRight className={RESOURCE_ROW_ARROW_CLASSES} />
                </>
              )

              return invoice.url ? (
                <a
                  key={invoice.id}
                  href={invoice.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={cn(rowClassName, 'hover-hover:bg-[var(--surface-active)]')}
                >
                  {rowContent}
                </a>
              ) : (
                <div key={invoice.id} className={cn(rowClassName, 'cursor-default')}>
                  {rowContent}
                </div>
              )
            })}

            {invoicesData?.hasMore && (
              <button
                type='button'
                onClick={handleOpenBillingPortal}
                disabled={openBillingPortal.isPending || !canManageBilling}
                aria-label='View all invoices'
                className={cn(
                  chipVariants({ fullWidth: true }),
                  'text-[var(--text-muted)] text-small'
                )}
              >
                View all
              </button>
            )}
          </div>
        </SettingsSection>
      )}

      {!subscription.isEnterprise && <CreditUsageSection />}
    </SettingsPanel>
  )
}
