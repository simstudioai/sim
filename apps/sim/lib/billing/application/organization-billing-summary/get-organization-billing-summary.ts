import { db, dbReplica } from '@sim/db'
import { organization, subscription as subscriptionTable } from '@sim/db/schema'
import { desc, eq } from 'drizzle-orm'
import { defineAuthorizedOrganizationBillingSummaryUseCase } from '@/lib/billing/application/organization-billing-summary/authorized-organization-billing-summary-use-case'
import { organizationBillingSummaryOperations } from '@/lib/billing/application/organization-billing-summary/operations'
import { getOrganizationSubscription, getPlanPricing } from '@/lib/billing/core/billing'
import {
  getOrganizationBillingBlockState,
  getUpgradeWorkspaceId,
} from '@/lib/billing/core/payer-context'
import { resolveSubscriptionUsagePeriodOrDefault } from '@/lib/billing/core/reporting-period'
import { resolveBillingInterval } from '@/lib/billing/core/subscription'
import { getBillingPeriodUsageCost } from '@/lib/billing/core/usage-log'
import { computeWeeklyRefreshConsumed } from '@/lib/billing/credits/weekly-refresh'
import { getPlanWeeklyRefreshDollars, isEnterprise, isPaid } from '@/lib/billing/plan-helpers'
import { getEffectiveSeats } from '@/lib/billing/subscriptions/utils'
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
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Returns only the payer state rendered above the fold on Organization Billing.
 * Member pages, invitation counts, member ledgers, and limit aggregates remain on
 * their dedicated surfaces instead of delaying this navigation-critical response.
 */
export const getOrganizationBillingSummary = defineAuthorizedOrganizationBillingSummaryUseCase({
  operation: organizationBillingSummaryOperations.read,
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
      dbReplica
        .select({
          id: organization.id,
          orgUsageLimit: organization.orgUsageLimit,
          creditBalance: organization.creditBalance,
        })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1),
      getOrganizationSubscription(organizationId, {
        executor: dbReplica,
        onError: 'throw',
      }),
      dbReplica
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.referenceId, organizationId))
        .orderBy(desc(subscriptionTable.periodStart), desc(subscriptionTable.id))
        .limit(1),
      getOrganizationBillingBlockState(organizationId, actorUserId, dbReplica),
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

    const weeklyRefreshDollars = getPlanWeeklyRefreshDollars(entitledSubscription?.plan)
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
    const { basePrice: pricePerSeat } = getPlanPricing(entitledSubscription?.plan ?? 'free')
    const licensedSeats = entitledSubscription?.seats || 1
    const totalSeats = entitledSubscription ? getEffectiveSeats(entitledSubscription) : 0
    const configuredLimit =
      entitledSubscription && organizationRecord.orgUsageLimit
        ? toNumber(toDecimal(organizationRecord.orgUsageLimit))
        : null
    const minimumBillingAmount =
      entitledSubscription && isEnterprise(entitledSubscription.plan)
        ? (configuredLimit ?? 0)
        : entitledSubscription
          ? licensedSeats * pricePerSeat
          : 0
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
    }
  },
})
