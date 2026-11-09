'use client'

import { useEffect } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/client'
import {
  getUpgradeCardCta,
  type PlanTier,
  type UpgradeCardId,
} from '@/lib/billing/client/plan-view'
import { useUpgradeState } from '@/lib/billing/client/upgrade-state'
import { ANNUAL_DISCOUNT_RATE } from '@/lib/billing/constants'
import { type CellValue, COMPARISON_SECTIONS, PLAN_COLUMNS } from '@/lib/billing/plan-comparison'
import {
  ENTERPRISE_PLAN_CREDITS,
  ENTERPRISE_PLAN_FEATURES,
  MAX_PLAN_CREDITS,
  MAX_PLAN_FEATURES,
  PRO_PLAN_CREDITS,
  PRO_PLAN_FEATURES,
} from '@/lib/billing/plan-configs'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { toast } from '@/lib/toast/sink'
import { useOrganizationBillingSummary } from '@/hooks/queries/organization-billing-summary'
import { useWorkspaceHostContextQuery } from '@/hooks/queries/workspace-host'

/** Enterprise "Talk to sales" books time with the sales team on Cal.com. */
const SALES_CAL_URL = 'https://cal.com/team/sim/demo'

export interface PlanCard {
  id: UpgradeCardId
  name: string
  segment: string
  price: string
  priceDetail?: string
  discount?: string
  credits: string
  refresh: string
  features: readonly string[]
  current: boolean
  cta: { label: string; primary: boolean; disabled: boolean; onClick: () => void }
}

/**
 * The workspace whose host billing is the organization, read the way legacy Billing links to the
 * upgrade page: the organization's billing summary names it, and its host context carries the plan.
 */
export function usePlanHost(organizationId: string) {
  const summary = useOrganizationBillingSummary(organizationId)
  const workspaceId = summary.data?.data?.upgradeWorkspaceId ?? null
  const host = useWorkspaceHostContextQuery(workspaceId ?? '')
  if (summary.error)
    return {
      status: 'error' as const,
      message: getErrorMessage(summary.error, 'Failed to load billing information'),
      retry: () => void summary.refetch(),
    }
  if (summary.isPending) return { status: 'pending' as const }
  if (!workspaceId) return { status: 'none' as const }
  if (host.error)
    return {
      status: 'error' as const,
      message: getErrorMessage(host.error, 'Failed to load this organization’s plan'),
      retry: () => void host.refetch(),
    }
  if (!host.data) return { status: 'pending' as const }
  return { status: 'ready' as const, workspaceId, hostContext: host.data }
}

function cellText(value: CellValue) {
  if (value === true) return 'Included'
  if (value === false) return '—'
  if (typeof value === 'object') return 'Slack'
  return value
}

/**
 * The legacy upgrade page's plan cards, period toggle and comparison, on the organization's host
 * workspace. Checkout, plan switches and the Enterprise exit run through `useUpgradeState` unchanged.
 */
export function usePlanPicker({
  hostContext,
  workspaceId,
  onLeave,
}: {
  hostContext: WorkspaceHostContext
  workspaceId: string
  onLeave: () => void
}) {
  const { data: session } = useSession()
  const state = useUpgradeState({ hostContext, workspaceId })
  const canManageBilling = canManageWorkspaceBilling(hostContext, session?.user?.id)
  const leaving = canManageBilling && state.subscription.isEnterprise

  useEffect(() => {
    if (leaving) onLeave()
  }, [leaving, onLeave])

  const unavailable =
    !canManageBilling || state.billedThroughMarketplace || state.billingLookupFailed
      ? {
          description: !canManageBilling
            ? 'Plans for this organization are managed by its administrators. Contact an organization admin to change its plan.'
            : state.billedThroughMarketplace
              ? 'Your subscription is billed through AWS Marketplace, so plans can’t be changed here.'
              : 'We couldn’t confirm how this organization is billed.',
          retry:
            canManageBilling && state.billingLookupFailed
              ? {
                  pending: state.isRetryingBillingLookup,
                  run: state.retryBillingLookup,
                }
              : null,
        }
      : null

  const planTier: PlanTier = state.subscription.isFree ? 'free' : state.isOnMaxTier ? 'max' : 'pro'
  const checkoutTarget = state.subscription.isOrgScoped ? 'team' : 'pro'

  function resolveCta(card: UpgradeCardId): PlanCard['cta'] {
    const cta = getUpgradeCardCta(planTier, card)
    const primary = cta.variant === 'primary'
    if (cta.intent === 'manage') {
      if (state.wantsIntervalSwitch)
        return {
          label: `Switch to ${state.isAnnual ? 'Annual' : 'Monthly'}`,
          primary,
          disabled: false,
          onClick: () =>
            void state
              .handleSwitchInterval(state.isAnnual ? 'year' : 'month')
              .catch((error) => toast.error(getErrorMessage(error, 'Failed to switch interval'))),
        }
      return { label: cta.label, primary, disabled: true, onClick: () => {} }
    }
    return {
      label: cta.label,
      primary,
      disabled: false,
      onClick: () => {
        if (cta.intent === 'sales') {
          window.open(SALES_CAL_URL, '_blank', 'noopener,noreferrer')
          return
        }
        if (cta.intent === 'downgrade') {
          void state.onUpgradeToOtherTier()
          return
        }
        if (card === 'max') {
          if (state.subscription.isPaid) void state.upgradeOrSwitchToMax()
          else void state.doUpgrade(checkoutTarget, state.maxTier.credits)
          return
        }
        void state.doUpgrade(checkoutTarget, state.proTier.credits)
      },
    }
  }

  const discount = state.isAnnual ? `${Math.round(ANNUAL_DISCOUNT_RATE * 100)}% off` : undefined
  const proPrice = `$${
    state.isAnnual
      ? Math.round(state.proTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
      : state.proTier.dollars
  }`
  const maxPrice = `$${
    state.isAnnual
      ? Math.round(state.maxTier.dollars * (1 - ANNUAL_DISCOUNT_RATE))
      : state.maxTier.dollars
  }`
  const priceDetail = state.isAnnual
    ? 'per user/month, billed annually'
    : 'per user/month, billed monthly'

  const plans: PlanCard[] = [
    {
      id: 'pro',
      name: 'Pro',
      segment: 'For growing teams',
      price: proPrice,
      priceDetail,
      discount,
      ...PRO_PLAN_CREDITS,
      features: PRO_PLAN_FEATURES,
      current: state.isOnPro,
      cta: resolveCta('pro'),
    },
    {
      id: 'max',
      name: 'Max',
      segment: 'For scaling businesses',
      price: maxPrice,
      priceDetail,
      discount,
      ...MAX_PLAN_CREDITS,
      features: MAX_PLAN_FEATURES,
      current: state.isOnMax,
      cta: resolveCta('max'),
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      segment: 'For large organizations',
      price: 'Custom',
      ...ENTERPRISE_PLAN_CREDITS,
      features: ENTERPRISE_PLAN_FEATURES,
      current: false,
      cta: resolveCta('enterprise'),
    },
  ]

  const prices: Record<string, string> = { Pro: proPrice, Max: maxPrice }
  const comparison = {
    plans: PLAN_COLUMNS.map((column) => ({
      key: column.name.toLowerCase(),
      label: `${column.name} ${column.staticPrice ?? prices[column.name]}`,
    })),
    sections: COMPARISON_SECTIONS.map((section) => ({
      title: section.title,
      rows: section.rows.map((row) => ({
        id: row.label,
        label: row.label,
        values: Object.fromEntries(
          PLAN_COLUMNS.map((column, index) => [
            column.name.toLowerCase(),
            cellText(row.values[index]),
          ])
        ),
      })),
    })),
  }

  return {
    hidden: leaving,
    unavailable,
    showPlans: state.showUpgradePlans,
    annual: state.isAnnual,
    setAnnual: state.setIsAnnual,
    plans,
    comparison,
  }
}
