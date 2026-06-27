'use client'

import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ArrowRight,
  Badge,
  Chip,
  ChipLink,
  Credit,
  chipVariants,
  Switch,
  toast,
} from '@/components/emcn'
import { useSession, useSubscription } from '@/lib/auth/auth-client'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { CREDIT_MULTIPLIER } from '@/lib/billing/credits/conversion'
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
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
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
  useOrganizations,
  useUpdateOrganizationUsageLimit,
} from '@/hooks/queries/organization'
import {
  prefetchUpgradeBillingData,
  useInvoices,
  useOpenBillingPortal,
  useSubscriptionData,
  useUpdateUsageLimit,
  useUsageLimitData,
} from '@/hooks/queries/subscription'
import { prefetchWorkspaceSettings, useWorkspaceSettings } from '@/hooks/queries/workspace'

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

/** Format a Unix-seconds timestamp as a short human-readable date. */
function formatInvoiceDate(createdSeconds: number): string {
  return new Date(createdSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Format a minor-unit (e.g. cents) amount as a localized currency string. */
function formatInvoiceAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100)
}

export function Billing() {
  const t = useTranslations('auto')
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()

  const {
    data: subscriptionData,
    isLoading: isSubscriptionLoading,
    refetch: refetchSubscription,
  } = useSubscriptionData({
    includeOrg: true,
  })
  const { data: usageLimitResponse, isLoading: isUsageLimitLoading } = useUsageLimitData()
  const { data: workspaceData, isLoading: isWorkspaceLoading } = useWorkspaceSettings(workspaceId)

  const { data: orgsData } = useOrganizations()
  const activeOrgId = orgsData?.activeOrganization?.id
  const workspaceOrganizationId = workspaceData?.settings?.workspace?.organizationId ?? null
  const billingOrganizationId =
    workspaceOrganizationId ?? subscriptionData?.data?.organization?.id ?? activeOrgId ?? null

  const { data: organizationBillingData, isLoading: isOrgBillingLoading } = useOrganizationBilling(
    billingOrganizationId || ''
  )

  const updateUserLimit = useUpdateUsageLimit()
  const updateOrgLimit = useUpdateOrganizationUsageLimit()

  const billingUsageNotificationsEnabled = useBillingUsageNotifications()
  const updateGeneralSetting = useUpdateGeneralSetting()

  const { data: session } = useSession()
  const betterAuthSubscription = useSubscription()
  const openBillingPortal = useOpenBillingPortal()

  const upgradeHref = buildUpgradeHref(workspaceId)

  /**
   * Warm the Upgrade route bundle and the exact queries that page gates on, so
   * the click navigates into already-cached data instead of a loading state.
   */
  const prefetchUpgrade = () => {
    router.prefetch(upgradeHref)
    prefetchUpgradeBillingData(queryClient)
    prefetchWorkspaceSettings(queryClient, workspaceId)
  }

  const hasOrgScopedSubscription = Boolean(subscriptionData?.data?.isOrgScoped)
  const isLoading =
    isSubscriptionLoading ||
    isUsageLimitLoading ||
    isWorkspaceLoading ||
    (hasOrgScopedSubscription && isOrgBillingLoading)

  const subscription = {
    isFree: isFree(subscriptionData?.data?.plan),
    isPro: isPro(subscriptionData?.data?.plan),
    isTeam: isTeam(subscriptionData?.data?.plan),
    isEnterprise: isEnterprise(subscriptionData?.data?.plan),
    isPaid:
      isPaid(subscriptionData?.data?.plan) &&
      hasPaidSubscriptionStatus(subscriptionData?.data?.status),
    /**
     * True when the subscription is attached to an org (regardless of plan
     * name). Drives routing of usage-limit edits and whether we show pooled
     * or personal usage.
     */
    isOrgScoped: Boolean(subscriptionData?.data?.isOrgScoped),
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
    minimumLimit: usageLimitResponse?.data?.minimumLimit || getPlanTierDollars(subscription.plan),
  }

  const isBlocked = Boolean(subscriptionData?.data?.billingBlocked)

  const userRole = subscriptionData?.data?.organization?.role ?? 'member'
  const isTeamAdmin = isOrgAdminRole(userRole)
  const shouldUseOrganizationBillingContext = subscription.isOrgScoped && isTeamAdmin

  const { data: invoicesData } = useInvoices({
    context: shouldUseOrganizationBillingContext ? 'organization' : 'user',
    organizationId: shouldUseOrganizationBillingContext
      ? (billingOrganizationId ?? undefined)
      : undefined,
    enabled: !subscription.isFree,
  })

  const planIncludedAmount =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.minimumBillingAmount
      : getPlanTierCredits(subscription.plan) / CREDIT_MULTIPLIER

  const effectiveUsageLimit =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.totalUsageLimit
      : usageLimitData.currentLimit || usage.limit

  const isOnDemandActive =
    subscription.isPaid && planIncludedAmount > 0 && effectiveUsageLimit > planIncludedAmount

  const effectiveCurrentUsage =
    subscription.isOrgScoped && organizationBillingData?.data?.totalCurrentUsage != null
      ? organizationBillingData.data.totalCurrentUsage
      : usage.current

  const canDisableOnDemand = isOnDemandActive && effectiveCurrentUsage <= planIncludedAmount

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

      if (isOnDemandActive) {
        if (!canDisableOnDemand) {
          toast.error("Can't turn off on-demand usage", {
            description:
              "Your usage is above your plan's included amount. It can be turned off once usage drops below it.",
          })
          return
        }
        if (shouldUseOrganizationBillingContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: billingOrganizationId!,
            limit: planIncludedAmount,
          })
        } else {
          await updateUserLimit.mutateAsync({ limit: planIncludedAmount })
        }
      } else {
        if (shouldUseOrganizationBillingContext) {
          await updateOrgLimit.mutateAsync({
            organizationId: billingOrganizationId!,
            limit: ON_DEMAND_UNLIMITED,
          })
        } else {
          await updateUserLimit.mutateAsync({ limit: ON_DEMAND_UNLIMITED })
        }
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
      await refetchSubscription()
    } catch (error) {
      logger.error('Failed to restore subscription', { error })
      toast.error("Couldn't restore subscription", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  if (isLoading) return null
  if (!subscriptionData?.data) return null

  const plan = subscription.plan
  const planName = getDisplayPlanName(plan)
  const billingPeriod =
    subscriptionData.data.billingInterval === 'year' ? 'billed annually' : 'billed monthly'
  const priceText = subscription.isEnterprise
    ? 'Custom pricing'
    : `$${getPlanTierDollars(plan)} per user/month, ${billingPeriod}`

  const periodEnd = subscriptionData.data.periodEnd ?? null
  const isCancelledAtPeriodEnd = subscriptionData.data.cancelAtPeriodEnd === true

  const invoices = (invoicesData?.invoices ?? []).map((invoice) => ({
    id: invoice.id,
    date: formatInvoiceDate(invoice.created),
    amount: formatInvoiceAmount(invoice.total, invoice.currency),
    badge: getInvoiceStatusBadge(invoice.status),
    url: invoice.hostedInvoiceUrl ?? invoice.invoicePdf,
  }))

  const canManageBilling = permissions.canEditUsageLimit
  const showUsageLimit = !subscription.isFree && !subscription.isEnterprise
  const showOnDemand = hasUsablePaidAccess && !subscription.isEnterprise

  const usageLimitCurrent =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.totalUsageLimit
      : usageLimitData.currentLimit || usage.limit

  const usageLimitMinimum =
    subscription.isOrgScoped && isTeamAdmin && organizationBillingData?.data
      ? organizationBillingData.data.minimumBillingAmount
      : usageLimitData.minimumLimit

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
            <span className='truncate text-[14px] text-[var(--text-body)]'>
              {planName} {t('plan')}
            </span>
            <span className='truncate text-[12px] text-[var(--text-muted)]'>{priceText}</span>
          </div>
        </div>
        {!subscription.isEnterprise &&
          (canManageBilling ? (
            <ChipLink
              href={upgradeHref}
              variant='border-shadow'
              flush
              onMouseEnter={prefetchUpgrade}
              onFocus={prefetchUpgrade}
            >
              {t('explore_plans')}
            </ChipLink>
          ) : (
            <Chip variant='border-shadow' flush disabled>
              {t('explore_plans')}
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
        <SettingsSection label={t('enable_on_demand_usage')}>
          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-body)] text-small'>
              {t('allow_usage_to_go_past_included')}
            </span>
            <Switch
              checked={isOnDemandActive}
              disabled={isTogglingOnDemand || !canManageBilling}
              onCheckedChange={handleToggleOnDemand}
            />
          </div>
        </SettingsSection>
      )}

      {!subscription.isFree && !subscription.isEnterprise && (
        <SettingsSection label={t('usage_notifications')}>
          <div className='flex items-center justify-between'>
            <span className='text-[var(--text-body)] text-small'>
              {t('email_me_when_i_reach_80')}
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
        <SettingsSection label={t('subscription')}>
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
              <span className='text-[var(--text-body)] text-small'>{t('payment_method')}</span>
              <Chip
                flush
                disabled={!canManageBilling || openBillingPortal.isPending}
                onClick={handleOpenBillingPortal}
              >
                {t('manage_in_stripe')}
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
                    {t('restore')}
                  </Chip>
                ) : (
                  <Chip
                    variant='destructive'
                    flush
                    disabled={!canManageBilling}
                    onClick={handleCancelSubscription}
                  >
                    {t('cancel')}
                  </Chip>
                )}
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      {!subscription.isFree && invoices.length > 0 && (
        <SettingsSection label={t('invoices')}>
          <div className='-mx-2 flex flex-col gap-y-0.5'>
            {invoices.map((invoice) => {
              const rowClassName =
                'flex items-center gap-2.5 rounded-lg p-2 text-left transition-colors'
              const rowContent = (
                <>
                  <span className='min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'>
                    {invoice.date}
                  </span>
                  <Badge variant={invoice.badge.variant} size='sm'>
                    {invoice.badge.label}
                  </Badge>
                  <span className='flex-shrink-0 text-[12px] text-[var(--text-muted)]'>
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
                aria-label={t('view_all_invoices')}
                className={cn(
                  chipVariants({ fullWidth: true }),
                  'text-[var(--text-muted)] text-small'
                )}
              >
                {t('view_all')}
              </button>
            )}
          </div>
        </SettingsSection>
      )}
    </SettingsPanel>
  )
}
