import { db, dbReplica } from '@sim/db'
import {
  enterpriseSeatTrueUp,
  organization,
  subscription as subscriptionTable,
} from '@sim/db/schema'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { defineAuthorizedOrganizationBillingUseCase } from '@/lib/billing/application/organization-billing/authorized-organization-billing-use-case'
import { organizationBillingOperations } from '@/lib/billing/application/organization-billing/operations'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import {
  getOrganizationBillingBlockState,
  getUpgradeWorkspaceId,
} from '@/lib/billing/core/payer-context'
import { resolveSubscriptionUsagePeriodOrDefault } from '@/lib/billing/core/reporting-period'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { getBillingPeriodUsageCost } from '@/lib/billing/core/usage-log'
import { computeWeeklyRefreshConsumed } from '@/lib/billing/credits/weekly-refresh'
import { isPaid } from '@/lib/billing/plan-helpers'
import {
  type EnterpriseSelfServeTerms,
  getEffectiveSeats,
  getEnterpriseSelfServeTerms,
  getOrgIncludedUsageDollars,
  getSubscriptionWeeklyRefreshDollars,
  isHardCappedEnterprise,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface OrganizationBillingSummaryInput {
  organizationId: string
}

export interface OrganizationBillingSummaryResult {
  organizationId: string
  subscriptionState: 'active' | 'free' | 'lapsed'
  subscriptionPlan: string
  subscriptionStatus: string | null
  creditBalance: number
  billingInterval: 'month' | 'year'
  cancelAtPeriodEnd: boolean
  totalSeats: number
  totalCurrentUsage: number
  totalUsageLimit: number
  minimumBillingAmount: number
  billingPeriodEnd: string | null
  billingBlocked: boolean
  billingBlockedReason: 'payment_failed' | 'dispute' | null
  blockedByOrgOwner: boolean
  upgradeWorkspaceId: string | null
  userRole: 'admin' | 'owner'
  /** The contract terms when the organization's Enterprise contract is self-serve, else null. */
  enterpriseSelfServe:
    | (EnterpriseSelfServeTerms & {
        /** The most seats past the contract so far in the open true-up window. */
        peakExtraSeats: number
      })
    | null
}

/**
 * The open true-up window's peak seats past the contract and the rate it bills them at, or null
 * before its first sample.
 */
async function getOpenTrueUpWindow(subscriptionId: string) {
  const [window] = await dbReplica
    .select({
      peakExtraSeats: enterpriseSeatTrueUp.peakExtraSeats,
      seatPriceCents: enterpriseSeatTrueUp.seatPriceCents,
    })
    .from(enterpriseSeatTrueUp)
    .where(
      and(
        eq(enterpriseSeatTrueUp.subscriptionId, subscriptionId),
        isNull(enterpriseSeatTrueUp.billedAt),
        // A closed window awaiting the hourly sweep is not the open one.
        gt(enterpriseSeatTrueUp.windowEnd, new Date())
      )
    )
    .orderBy(desc(enterpriseSeatTrueUp.windowStart))
    .limit(1)
  return window ?? null
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Returns only the payer state rendered above the fold on Organization Billing.
 * Member pages, invitation counts, member ledgers, and limit aggregates remain on
 * their dedicated surfaces instead of delaying this navigation-critical response.
 */
export const getOrganizationBillingSummary = defineAuthorizedOrganizationBillingUseCase({
  operation: organizationBillingOperations.read,
  organizationId: (input: OrganizationBillingSummaryInput) => input.organizationId,
  async execute({ context }): Promise<OrganizationBillingSummaryResult> {
    const { organizationId, actorUserId, userRole } = context
    const [
      organizationRows,
      entitledSubscription,
      latestSubscriptionRows,
      billingStatus,
      upgradeWorkspaceId,
    ] = await Promise.all([
      db
        .select({
          id: organization.id,
          orgUsageLimit: organization.orgUsageLimit,
          creditBalance: organization.creditBalance,
        })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1),
      getOrganizationSubscription(organizationId, {
        executor: db,
        onError: 'throw',
      }),
      db
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.referenceId, organizationId))
        .orderBy(desc(subscriptionTable.periodStart), desc(subscriptionTable.id))
        .limit(1),
      getOrganizationBillingBlockState(organizationId, actorUserId, db),
      getUpgradeWorkspaceId({ type: 'organization', id: organizationId }, db),
    ])

    const organizationRecord = organizationRows[0]
    if (!organizationRecord) {
      throw new OrchestrationError('not_found', 'Organization not found')
    }

    const latestSubscription = latestSubscriptionRows[0] ?? null
    const activeSubscription =
      entitledSubscription && isPaid(entitledSubscription.plan) ? entitledSubscription : null
    const freeSubscription =
      entitledSubscription && !isPaid(entitledSubscription.plan) ? entitledSubscription : null
    const lapsedSubscription =
      !entitledSubscription && latestSubscription && isPaid(latestSubscription.plan)
        ? latestSubscription
        : null
    const displayedSubscription = activeSubscription ?? freeSubscription ?? lapsedSubscription
    const subscriptionState = activeSubscription ? 'active' : lapsedSubscription ? 'lapsed' : 'free'
    const billingPeriod = entitledSubscription
      ? resolveSubscriptionUsagePeriodOrDefault(entitledSubscription)
      : null

    const weeklyRefreshDollars = getSubscriptionWeeklyRefreshDollars(entitledSubscription)
    const [ledgerUsage, weeklyRefreshConsumed] = billingPeriod
      ? await Promise.all([
          getBillingPeriodUsageCost(
            { type: 'organization', id: organizationId },
            billingPeriod,
            undefined,
            dbReplica
          ),
          entitledSubscription && weeklyRefreshDollars > 0 && entitledSubscription.periodStart
            ? computeWeeklyRefreshConsumed(
                {
                  billingEntity: { type: 'organization', id: organizationId },
                  periodStart: entitledSubscription.periodStart,
                  periodEnd: entitledSubscription.periodEnd ?? null,
                  weeklyRefreshDollars,
                  seats: entitledSubscription.seats || 1,
                },
                dbReplica
              )
            : Promise.resolve(0),
        ])
      : [0, 0]

    const totalCurrentUsage = Math.max(0, ledgerUsage - weeklyRefreshConsumed)
    const totalSeats = entitledSubscription ? getEffectiveSeats(entitledSubscription) : 0
    const configuredLimit =
      entitledSubscription && organizationRecord.orgUsageLimit
        ? toNumber(toDecimal(organizationRecord.orgUsageLimit))
        : null
    const selfServeTerms = entitledSubscription
      ? getEnterpriseSelfServeTerms(entitledSubscription)
      : null
    const openWindow =
      entitledSubscription && selfServeTerms
        ? await getOpenTrueUpWindow(entitledSubscription.id)
        : null
    // The open window bills at the rate it opened with, which a mid-window change does not move.
    const enterpriseSelfServe = selfServeTerms
      ? {
          ...selfServeTerms,
          seatPriceCents: openWindow?.seatPriceCents ?? selfServeTerms.seatPriceCents,
          peakExtraSeats: openWindow?.peakExtraSeats ?? 0,
        }
      : null
    // A hard-capped Enterprise contract includes exactly its configured limit.
    const minimumBillingAmount = !entitledSubscription
      ? 0
      : isHardCappedEnterprise(entitledSubscription)
        ? (configuredLimit ?? 0)
        : getOrgIncludedUsageDollars(entitledSubscription)
    const totalUsageLimit =
      configuredLimit === null
        ? minimumBillingAmount
        : Math.max(configuredLimit, minimumBillingAmount)
    return {
      organizationId,
      subscriptionState,
      subscriptionPlan: displayedSubscription?.plan ?? 'free',
      subscriptionStatus: displayedSubscription?.status ?? null,
      creditBalance: toNumber(toDecimal(organizationRecord.creditBalance)),
      billingInterval: resolveBillingInterval(displayedSubscription),
      cancelAtPeriodEnd: displayedSubscription?.cancelAtPeriodEnd ?? false,
      totalSeats,
      totalCurrentUsage: roundCurrency(totalCurrentUsage),
      totalUsageLimit: roundCurrency(totalUsageLimit),
      minimumBillingAmount: roundCurrency(minimumBillingAmount),
      billingPeriodEnd:
        (billingPeriod?.end ?? displayedSubscription?.periodEnd)?.toISOString() ?? null,
      ...billingStatus,
      upgradeWorkspaceId,
      userRole,
      enterpriseSelfServe,
    }
  },
})
