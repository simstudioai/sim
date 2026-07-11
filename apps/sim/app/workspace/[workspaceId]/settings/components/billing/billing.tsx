'use client'
import {
  ArrowRight,
  Badge,
  Chip,
  ChipLink,
  Credit,
  chipVariants,
  cn,
  Switch,
  Tooltip,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import { useSession, useSubscription } from '@/lib/auth/auth-client'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
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
  isEnterprise,
  isFree,
  isPaid,
  isPro,
  isTeam,
} from '@/lib/billing/plan-helpers'
import {
  getEffectiveSeats,
  hasPaidSubscriptionStatus,
  hasUsableSubscriptionAccess,
} from '@/lib/billing/subscriptions/utils'
import { buildUpgradeHref } from '@/lib/billing/upgrade-reasons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { CreditUsageSection } from '@/app/workspace/[workspaceId]/settings/components/billing/components/credit-usage-section/credit-usage-section'
import { UsageLimitField } from '@/app/workspace/[workspaceId]/settings/components/billing/components/usage-limit-field/usage-limit-field'
import { getSubscriptionPermissions } from '@/app/workspace/[workspaceId]/settings/components/billing/subscription-permissions'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useBillingUsageNotifications,
  useUpdateGeneralSetting,
} from '@/hooks/queries/general-settings'
import {
  useOrganizationBilling,
  useUpdateOrganizationUsageLimit,
} from '@/hooks/queries/organization'
import {
  useInvoices,
  useOpenBillingPortal,
  useSubscriptionData,
  useUpdateUsageLimit,
} from '@/hooks/queries/subscription'

const logger = createLogger('Billing')

type InvoiceStatusBadge = { variant: 'green' | 'amber' | 'red' | 'gray'; label: string }

const INVOICE_STATUS_BADGES: Record<string, InvoiceStatusBadge> = {
  paid: { variant: 'green', label: 'Paid' },
  open: { variant: 'amber', label: 'Open' },
  uncollectible: { variant: 'red', label: 'Uncollectible' },
  void: { variant: 'gray', label: 'Void' },
}

/** Resolve a Stripe invoice status to its badge presentation. */
function getInvoiceStatusBadge(status: string | null): InvoiceStatusBadge {
  return INVOICE_STATUS_BADGES[status ?? ''] ?? { variant: 'gray', label: status ?? 'Unknown' }
}

/** Cached currency formatters, keyed by upper-cased ISO currency code. */
const invoiceAmountFormatters = new Map<string, Intl.NumberFormat>()

/** Resolve (and memoize) an `Intl.NumberFormat` for a currency code. */
function getInvoiceAmountFormatter(currency: string): Intl.NumberFormat {
  const code = currency.toUpperCase()
  let formatter = invoiceAmountFormatters.get(code)
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
    invoiceAmountFormatters.set(code, formatter)
  }
  return formatter
}

/** Format a minor-unit (e.g. cents) amount as a localized currency string. */
function formatInvoiceAmount(amountMinor: number, currency: string): string {
  return getInvoiceAmountFormatter(currency).format(amountMinor / 100)
}

interface BillingProps {
  scope: 'account' | 'organization'
  organizationId?: string
  creditUsageHref?: string
}

export function Billing({ scope, organizationId, creditUsageHref }: BillingProps) {
  const router = useRouter()
  const isOrganizationScope = scope === 'organization'

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData({
    includeOrg: false,
    enabled: !isOrganizationScope,
  })
  const billingOrganizationId = isOrganizationScope ? (organizationId ?? null) : null

  const {
    data: organizationBillingData,
    isLoading: isOrgBillingLoading,
    refetch: refetchOrganizationBilling,
  } = useOrganizationBilling(billingOrganizationId || '', { enabled: isOrganizationScope })

  const updateUserLimit = useUpdateUsageLimit()
  const updateOrgLimit = useUpdateOrganizationUsageLimit()

  const billingUsageNotificationsEnabled = useBillingUsageNotifications()
  const updateGeneralSetting = useUpdateGeneralSetting()

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const openBillingPortal = useOpenBillingPortal()

  const organizationBilling = organizationBillingData?.data
  const upgradeWorkspaceId = isOrganizationScope
    ? organizationBilling?.upgradeWorkspaceId
    : subscriptionData?.data?.upgradeWorkspaceId
  const upgradeHref = upgradeWorkspaceId ? buildUpgradeHref(upgradeWorkspaceId) : null
  const prefetchUpgrade = () => {
    if (upgradeHref) router.prefetch(upgradeHref)
  }

  const plan = isOrganizationScope
    ? (organizationBilling?.subscriptionPlan ?? 'free')
    : (subscriptionData?.data?.plan ?? 'free')
  const status = isOrganizationScope
    ? (organizationBilling?.subscriptionStatus ?? 'inactive')
    : (subscriptionData?.data?.status ?? 'inactive')
  const isLoading = isOrganizationScope ? isOrgBillingLoading : isSubscriptionLoading

  const subscription = {
    isFree: isFree(plan),
    isPro: isPro(plan),
    isTeam: isTeam(plan),
    isEnterprise: isEnterprise(plan),
    isPaid: isPaid(plan) && hasPaidSubscriptionStatus(status),
    /**
     * True when the subscription is attached to an org (regardless of plan
     * name). Drives routing of usage-limit edits and whether we show pooled
     * or personal usage.
     */
    isOrgScoped: isOrganizationScope,
    plan,
    status,
    seats: isOrganizationScope
      ? (organizationBilling?.totalSeats ?? 0)
      : getEffectiveSeats(subscriptionData?.data),
  }

  const usage = {
    current: isOrganizationScope
      ? (organizationBilling?.totalCurrentUsage ?? 0)
      : (subscriptionData?.data?.usage?.current ?? 0),
    limit: isOrganizationScope
      ? (organizationBilling?.totalUsageLimit ?? 0)
      : (subscriptionData?.data?.usage?.limit ?? 0),
    percentUsed: isOrganizationScope
      ? organizationBilling?.totalUsageLimit
        ? (organizationBilling.totalCurrentUsage / organizationBilling.totalUsageLimit) * 100
        : 0
      : (subscriptionData?.data?.usage?.percentUsed ?? 0),
  }

  const isBlocked = isOrganizationScope
    ? Boolean(organizationBilling?.billingBlocked)
    : Boolean(subscriptionData?.data?.billingBlocked)

  const userRole = isOrganizationScope ? (organizationBillingData?.userRole ?? 'member') : 'owner'
  const isTeamAdmin = isOrgAdminRole(userRole)
  const shouldUseOrganizationBillingContext = isOrganizationScope

  const { data: invoicesData } = useInvoices({
    context: shouldUseOrganizationBillingContext ? 'organization' : 'user',
    organizationId: shouldUseOrganizationBillingContext
      ? (billingOrganizationId ?? undefined)
      : undefined,
    enabled: !subscription.isFree,
  })

  const planIncludedAmount =
    subscription.isOrgScoped && organizationBilling
      ? organizationBilling.minimumBillingAmount
      : getPlanTierCredits(subscription.plan) / CREDIT_MULTIPLIER

  const effectiveUsageLimit =
    subscription.isOrgScoped && organizationBilling
      ? organizationBilling.totalUsageLimit
      : usage.limit

  const effectiveCurrentUsage =
    subscription.isOrgScoped && organizationBilling?.totalCurrentUsage != null
      ? organizationBilling.totalCurrentUsage
      : usage.current

  /**
   * Goodwill credits are already baked into the usage limit by
   * `setUsageLimitForCredits` (limit = planBase + creditBalance). `covered` is
   * that same never-billed ceiling, so on-demand is "on" only when the limit is
   * raised above it — a credit grant alone must not read as on-demand.
   * Each scope reads its exact payer balance from the matching billing DTO.
   */
  const creditBalance = isOrganizationScope
    ? (organizationBilling?.creditBalance ?? 0)
    : (subscriptionData?.data?.creditBalance ?? 0)
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
      isOrgScoped: subscription.isOrgScoped,
      plan: subscription.plan || 'free',
      status: subscription.status || 'inactive',
    },
    { isTeamAdmin, userRole: userRole || 'member' }
  )

  const hasUsablePaidAccess = subscription.isPaid
    ? hasUsableSubscriptionAccess(subscription.status, isBlocked)
    : false

  const isTogglingOnDemand = updateUserLimit.isPending || updateOrgLimit.isPending

  const handleToggleOnDemand = async () => {
    if (!permissions.canEditUsageLimit) {
      toast.error("Can't change on-demand usage", {
        description: 'Only organization admins can change on-demand usage.',
      })
      return
    }

    try {
      if (shouldUseOrganizationBillingContext && !billingOrganizationId) {
        throw new Error(
          'Organization billing context is unavailable. Please refresh and try again.'
        )
      }

      const nextLimit = isOnDemandActive
        ? getOnDemandOffLimit(effectiveCurrentUsage, covered)
        : ON_DEMAND_UNLIMITED

      if (shouldUseOrganizationBillingContext) {
        await updateOrgLimit.mutateAsync({
          organizationId: billingOrganizationId!,
          limit: nextLimit,
        })
      } else {
        await updateUserLimit.mutateAsync({ limit: nextLimit })
      }
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
    const portalWindow = window.open('', '_blank')
    const context = subscription.isOrgScoped ? 'organization' : 'user'
    if (context === 'organization' && !billingOrganizationId) {
      portalWindow?.close()
      toast.error('Billing unavailable', {
        description: 'Organization billing context is unavailable. Please refresh and try again.',
      })
      return
    }
    openBillingPortal.mutate(
      {
        context,
        organizationId: billingOrganizationId ?? undefined,
        returnUrl: window.location.href,
      },
      {
        onSuccess: (data) => {
          if (portalWindow) portalWindow.location.href = data.url
          else window.location.href = data.url
        },
        onError: (error) => {
          portalWindow?.close()
          logger.error('Failed to open billing portal', { error })
          toast.error("Couldn't open billing portal", {
            description: getErrorMessage(error, 'Please try again in a moment.'),
          })
        },
      }
    )
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
      if (subscription.isOrgScoped && !billingOrganizationId) {
        throw new Error(
          'Organization billing context is unavailable. Please refresh and try again.'
        )
      }
      const referenceId = subscription.isOrgScoped ? billingOrganizationId : session?.user?.id
      const returnUrl = getBaseUrl() + window.location.pathname
      await betterAuthSubscription.cancel({ returnUrl, referenceId: referenceId || '' })
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
      if (subscription.isOrgScoped && !billingOrganizationId) {
        throw new Error(
          'Organization billing context is unavailable. Please refresh and try again.'
        )
      }
      const referenceId = subscription.isOrgScoped ? billingOrganizationId : session?.user?.id
      await betterAuthSubscription.restore({ referenceId: referenceId || '' })
      if (isOrganizationScope) await refetchOrganizationBilling()
      else await refetchSubscription()
    } catch (error) {
      logger.error('Failed to restore subscription', { error })
      toast.error("Couldn't restore subscription", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  if (isLoading) return null
  if (isOrganizationScope ? !organizationBilling : !subscriptionData?.data) return null

  const planName = getDisplayPlanName(subscription.plan)
  const billingInterval = isOrganizationScope
    ? organizationBilling?.billingInterval
    : subscriptionData?.data?.billingInterval
  const billingPeriod = billingInterval === 'year' ? 'billed annually' : 'billed monthly'
  const organizationSubscriptionState = organizationBilling?.subscriptionState
  const planTitle = isOrganizationScope
    ? organizationSubscriptionState === 'lapsed'
      ? `Organization ${planName} plan ended`
      : `Organization ${planName} plan`
    : `Personal ${planName} plan`
  const priceText =
    organizationSubscriptionState === 'free'
      ? 'No active organization subscription'
      : organizationSubscriptionState === 'lapsed'
        ? 'Choose a new plan for this organization'
        : subscription.isEnterprise
          ? 'Custom pricing'
          : `$${getPlanTierDollars(subscription.plan)} per user/month, ${billingPeriod}`

  const periodEnd = isOrganizationScope
    ? (organizationBilling?.billingPeriodEnd ?? null)
    : (subscriptionData?.data?.periodEnd ?? null)
  const isCancelledAtPeriodEnd = isOrganizationScope
    ? organizationBilling?.cancelAtPeriodEnd === true
    : subscriptionData?.data?.cancelAtPeriodEnd === true

  const invoices = (invoicesData?.invoices ?? []).map((invoice) => ({
    id: invoice.id,
    date: formatDate(new Date(invoice.created * 1000)),
    amount: formatInvoiceAmount(invoice.total, invoice.currency),
    badge: getInvoiceStatusBadge(invoice.status),
    url: invoice.hostedInvoiceUrl ?? invoice.invoicePdf,
  }))

  const canManageBilling = permissions.canEditUsageLimit
  const canExplorePlans = permissions.showUpgradePlans
  const showUsageLimit = subscription.isPaid && !subscription.isEnterprise
  const showOnDemand = hasUsablePaidAccess && !subscription.isEnterprise

  const usageLimitCurrent =
    subscription.isOrgScoped && organizationBilling
      ? organizationBilling.totalUsageLimit
      : usage.limit

  const usageLimitMinimum =
    subscription.isOrgScoped && organizationBilling
      ? organizationBilling.minimumBillingAmount
      : getPlanTierDollars(subscription.plan)
  const explorePlansLabel = isOrganizationScope
    ? 'Explore organization plans'
    : 'Explore personal plans'

  return (
    <SettingsPanel>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2.5'>
          <div className='size-9 flex-shrink-0'>
            <div className='flex size-full items-center justify-center rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
              <Credit className='size-5 text-[var(--text-icon)]' />
            </div>
          </div>
          <div className='flex min-w-0 flex-col'>
            <span className='truncate text-[var(--text-body)] text-sm'>{planTitle}</span>
            <span className='truncate text-[var(--text-muted)] text-caption'>{priceText}</span>
          </div>
        </div>
        {!subscription.isEnterprise &&
          (canExplorePlans && upgradeHref ? (
            <ChipLink
              href={upgradeHref}
              variant='border-shadow'
              flush
              onMouseEnter={prefetchUpgrade}
              onFocus={prefetchUpgrade}
            >
              {explorePlansLabel}
            </ChipLink>
          ) : (
            <Chip variant='border-shadow' flush disabled>
              {explorePlansLabel}
            </Chip>
          ))}
      </div>

      {showUsageLimit && (
        <UsageLimitField
          currentLimit={usageLimitCurrent}
          minimumLimit={usageLimitMinimum}
          canEdit={permissions.canEditUsageLimit}
          context={shouldUseOrganizationBillingContext ? 'organization' : 'user'}
          organizationId={
            shouldUseOrganizationBillingContext ? (billingOrganizationId ?? undefined) : undefined
          }
        />
      )}

      {showOnDemand && (
        <SettingsSection label='Enable on-demand usage'>
          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-body)] text-small'>
              Allow usage to go past included usage
            </span>
            {onDemandLockedOn ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='inline-flex'>
                    <Switch checked disabled onCheckedChange={handleToggleOnDemand} />
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
                checked={isOnDemandActive}
                disabled={isTogglingOnDemand || !canManageBilling}
                onCheckedChange={handleToggleOnDemand}
              />
            )}
          </div>
        </SettingsSection>
      )}

      {!isOrganizationScope && !subscription.isFree && !subscription.isEnterprise && (
        <SettingsSection label='Usage notifications'>
          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-body)] text-small'>
              Email me when I reach 80% usage
            </span>
            <Switch
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

            <div className='flex items-center justify-between'>
              <span className='text-[var(--text-body)] text-small'>Payment method</span>
              <Chip
                flush
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
                    flush
                    disabled={!canManageBilling}
                    onClick={handleRestoreSubscription}
                  >
                    Restore
                  </Chip>
                ) : (
                  <Chip
                    variant='destructive'
                    flush
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

      {!subscription.isFree && invoices.length > 0 && (
        <SettingsSection label='Invoices'>
          <div className='-mx-2 flex flex-col gap-y-0.5'>
            {invoices.map((invoice) => {
              const rowClassName =
                'flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors'
              const rowContent = (
                <>
                  <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
                    {invoice.date}
                  </span>
                  <Badge variant={invoice.badge.variant} size='sm'>
                    {invoice.badge.label}
                  </Badge>
                  <span className='flex-shrink-0 text-[var(--text-muted)] text-caption'>
                    {invoice.amount}
                  </span>
                  <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
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

      {!isOrganizationScope && !subscription.isEnterprise && (
        <CreditUsageSection href={creditUsageHref} />
      )}
    </SettingsPanel>
  )
}
