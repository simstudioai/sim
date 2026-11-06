'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { useSubscription } from '@/lib/auth/client'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { dollarsToCredits, formatCreditCost } from '@/lib/billing/credits/conversion'
import { formatInvoiceAmount, getInvoiceStatusBadge } from '@/lib/billing/invoices'
import {
  getCoveredUsage,
  getIsOnDemandActive,
  getOnDemandOffLimit,
  isOnDemandOffDisabled,
} from '@/lib/billing/on-demand'
import {
  getDisplayPlanName,
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
import { isUsageLimitDraftDirty, resolveUsageLimitDraft } from '@/lib/billing/usage-limit-draft'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { useUpdateOrganizationUsageLimit } from '@/hooks/queries/organization'
import { useOrganizationBillingSummary } from '@/hooks/queries/organization-billing-summary'
import { useInvoices, useOpenBillingPortal } from '@/hooks/queries/subscription'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import { reportFailure } from '@/platform/embedded/lib/notices'
import { queryView } from '@/platform/shared/query-view'
import { formatInstantDate } from '@/platform/shared/time'

const logger = createLogger('PlatformBilling')

/** Delay before a usage-limit edit is saved once the viewer stops typing. */
const AUTOSAVE_DELAY_MS = 1000

const INVOICE_INTENTS = {
  green: 'success',
  amber: 'warning',
  red: 'danger',
  gray: 'neutral',
} as const

interface UsageLimitDraftOptions {
  current: number
  minimum: number
  canEdit: boolean
  organizationId: string
  update: ReturnType<typeof useUpdateOrganizationUsageLimit>
}

/**
 * The usage limit's draft in credits, saved shortly after typing stops. Limits are stored in dollars.
 * The save decides against the limit and minimum as they stand when the wait ends, not when the key
 * was pressed, and `discard` drops a wait another write to the same limit has overtaken.
 */
function useUsageLimitDraft({
  current,
  minimum,
  canEdit,
  organizationId,
  update,
}: UsageLimitDraftOptions) {
  const save = update.mutate
  const [draft, setDraft] = useState<string | null>(null)
  const latest = useRef({ current, minimum })
  useEffect(() => {
    latest.current = { current, minimum }
  })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }
  useEffect(() => cancelPendingSave, [])
  const discard = () => {
    cancelPendingSave()
    setDraft(null)
  }
  useSettingsUnsavedGuard({
    isDirty: canEdit && draft !== null && isUsageLimitDraftDirty(draft, current),
    navigationBlocked: update.isPending,
    onDiscard: discard,
  })
  const change = (next: string) => {
    setDraft(next)
    cancelPendingSave()
    if (!canEdit) return
    saveTimer.current = setTimeout(() => {
      const settle = () => setDraft((value) => (value === next ? null : value))
      const decision = resolveUsageLimitDraft(next, latest.current.current, latest.current.minimum)
      if (decision.kind === 'settled') settle()
      if (decision.kind === 'invalid') toast.error(decision.message)
      if (decision.kind === 'save') {
        save(
          { organizationId, limit: decision.limitDollars },
          {
            onSuccess: settle,
            onError: (error) => reportFailure("Couldn't update usage limit", error),
          }
        )
      }
    }, AUTOSAVE_DELAY_MS)
  }
  const unlimited = current >= ON_DEMAND_UNLIMITED
  return {
    field: {
      value: draft ?? (unlimited ? '' : String(dollarsToCredits(current))),
      placeholder: unlimited ? 'No usage limit' : String(dollarsToCredits(current)),
      disabled: !canEdit || update.isPending,
      change,
    },
    discard,
  }
}

/**
 * The organization's subscription, with the legacy panel's rules. A failed read is an error, never
 * a plan: nothing here reports over-limit or blocked from a summary that did not load, so usage that
 * is merely unavailable never reads as usage that is over.
 */
export function useBillingSection(organization: OrganizationSurfaceContext) {
  const organizationId = organization.organization.id
  const summary = useOrganizationBillingSummary(organizationId)
  const invoiceList = useInvoices({ context: 'organization', organizationId })
  const updateLimit = useUpdateOrganizationUsageLimit()
  const portal = useOpenBillingPortal()
  const subscriptionClient = useSubscription()

  const billing = summary.data?.data
  const plan = billing?.subscriptionPlan ?? 'free'
  const status = billing?.subscriptionStatus ?? 'inactive'
  const enterprise = isEnterprise(plan)
  const free = isFree(plan)
  const paid = isPaid(plan) && hasPaidSubscriptionStatus(status)
  const permissions = getSubscriptionPermissions(
    {
      isFree: free,
      isPro: isPro(plan),
      isTeam: isTeam(plan),
      isEnterprise: enterprise,
      isPaid: paid,
      isOrgScoped: true,
      plan,
      status,
    },
    { isTeamAdmin: isOrgAdminRole(billing?.userRole), userRole: billing?.userRole ?? 'member' }
  )
  const canManage = permissions.canEditUsageLimit

  const included = billing?.minimumBillingAmount ?? 0
  const limit = billing?.totalUsageLimit ?? 0
  const current = billing?.totalCurrentUsage ?? 0
  const covered = getCoveredUsage(included, billing?.creditBalance ?? 0)
  const onDemandActive = getIsOnDemandActive({
    isPaid: paid,
    planIncludedAmount: included,
    effectiveUsageLimit: limit,
    covered,
  })
  const onDemandLocked = isOnDemandOffDisabled({
    isOnDemandActive: onDemandActive,
    effectiveCurrentUsage: current,
    covered,
  })
  const usablePaidAccess =
    paid && hasUsableSubscriptionAccess(status, Boolean(billing?.billingBlocked))
  const usageLimit = useUsageLimitDraft({
    current: limit,
    minimum: included,
    canEdit: canManage,
    organizationId,
    update: updateLimit,
  })

  const planName = getDisplayPlanName(plan)
  const interval = billing?.billingInterval === 'year' ? 'billed annually' : 'billed monthly'
  const state = billing?.subscriptionState
  const weeklyRefresh = getPlanWeeklyRefreshDollars(plan) * (billing?.totalSeats || 1)
  const upgradeHref = billing?.upgradeWorkspaceId
    ? buildUpgradeHref(billing.upgradeWorkspaceId)
    : null

  function openPortal() {
    if (!canManage) return
    portal.open(
      { context: 'organization', organizationId, returnUrl: window.location.href },
      (error) => {
        logger.error('Failed to open billing portal', { error })
        reportFailure("Couldn't open billing portal", error)
      }
    )
  }

  return {
    ...queryView(summary),
    error: summary.error
      ? getErrorMessage(summary.error, 'Failed to load billing information')
      : '',
    planTitle: state === 'lapsed' ? `${planName} plan ended` : `${planName} plan`,
    priceText:
      state === 'free'
        ? 'No active organization subscription'
        : state === 'lapsed'
          ? 'Choose a new plan for this organization'
          : enterprise
            ? 'Custom pricing'
            : `$${getPlanTierDollars(plan)} per user/month, ${interval}`,
    showExplorePlans: !enterprise,
    explorePlansHref: permissions.showUpgradePlans ? upgradeHref : null,
    showUsageLimit: paid && !enterprise,
    usageLimit: usageLimit.field,
    showOnDemand: usablePaidAccess && !enterprise,
    onDemand: {
      active: onDemandActive,
      locked: onDemandLocked,
      disabled: onDemandLocked || updateLimit.isPending || !canManage,
      toggle: async () => {
        if (!canManage || onDemandLocked || updateLimit.isPending) return
        usageLimit.discard()
        try {
          await updateLimit.mutateAsync({
            organizationId,
            limit: onDemandActive ? getOnDemandOffLimit(current, covered) : ON_DEMAND_UNLIMITED,
          })
        } catch (error) {
          logger.error('Failed to toggle on-demand billing', { error })
          reportFailure("Couldn't update on-demand usage", error)
        }
      },
    },
    showSubscription: paid || enterprise,
    periodEndLabel: billing?.cancelAtPeriodEnd ? 'Access until' : 'Next billing date',
    periodEnd: billing?.billingPeriodEnd ? formatInstantDate(billing.billingPeriodEnd) : null,
    weeklyRefresh: paid && weeklyRefresh > 0 ? `+${formatCreditCost(weeklyRefresh)}` : null,
    canManage,
    canOpenPortal: canManage,
    portalDisabledReason: enterprise
      ? 'Enterprise billing is handled by your account team.'
      : 'Only organization owners and admins can manage payment.',
    portalPending: portal.isPending,
    openPortal,
    showCancellation: !enterprise,
    cancelled: billing?.cancelAtPeriodEnd === true,
    cancel: async () => {
      if (!permissions.canCancelSubscription) return
      if (!subscriptionClient.cancel) return
      try {
        await subscriptionClient.cancel({
          returnUrl: getBaseUrl() + window.location.pathname,
          referenceId: organizationId,
        })
      } catch (error) {
        logger.error('Failed to cancel subscription', { error })
        reportFailure("Couldn't cancel subscription", error)
      }
    },
    restore: async () => {
      if (!permissions.canCancelSubscription) return
      if (!subscriptionClient.restore) return
      try {
        await subscriptionClient.restore({ referenceId: organizationId })
        await summary.refetch()
      } catch (error) {
        logger.error('Failed to restore subscription', { error })
        reportFailure("Couldn't restore subscription", error)
      }
    },
    invoices: free
      ? []
      : (invoiceList.data?.invoices ?? []).map((invoice) => {
          const badge = getInvoiceStatusBadge(invoice.status)
          return {
            id: invoice.id,
            date: formatInstantDate(invoice.created * 1000),
            amount: formatInvoiceAmount(invoice.total, invoice.currency),
            description: invoice.description,
            statusLabel: badge.label,
            statusIntent: INVOICE_INTENTS[badge.variant],
            url: invoice.hostedInvoiceUrl ?? invoice.invoicePdf,
          }
        }),
    hasMoreInvoices: Boolean(invoiceList.data?.hasMore),
    invoicesFailed: !free && invoiceList.isError && !invoiceList.data,
    retryInvoices: () => void invoiceList.refetch(),
  }
}
