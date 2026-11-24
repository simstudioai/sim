import { db } from '@sim/db'
import { organization, subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { type AnyColumn, eq, sql } from 'drizzle-orm'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { writeBillingInterval } from '@/lib/billing/core/subscription'
import {
  getOrgIncludedUsageDollars,
  getPlanPricing,
  isTrialingSubscription,
  type OrgAllowanceInput,
  resolveBillingInterval,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal } from '@/lib/billing/utils/decimal'

const logger = createLogger('PlanSwitch')

interface SwitchedSubscription extends OrgAllowanceInput {
  id: string
  plan: string
  referenceId: string
  status: string | null
  trialEnd?: Date | null
}

/**
 * Records a tier or billing-interval change Stripe has already applied: the plan, the interval,
 * and the payer's usage limit.
 *
 * The limit moves with the plan's included usage. A limit the payer never raised sits at the old
 * allowance plus prepaid credit; left there after a move to a cheaper plan or a monthly interval,
 * it would read as on-demand usage nobody turned on and bill overage past the new allowance. A
 * limit the payer raised keeps its on-demand headroom above the allowance, rescaled to the new
 * interval (a year's headroom becomes a month's twelfth), and an unlimited limit stays unlimited.
 * A personal trial keeps its fixed allowance.
 */
export async function recordPlanSwitch(params: {
  subscription: SwitchedSubscription
  targetPlanName: string
  targetInterval: 'month' | 'year'
  orgScoped: boolean
}): Promise<void> {
  const { subscription, targetPlanName, targetInterval, orgScoped } = params

  if (subscription.plan !== targetPlanName) {
    await db
      .update(subscriptionTable)
      .set({ plan: targetPlanName })
      .where(eq(subscriptionTable.id, subscription.id))
  }
  await writeBillingInterval(subscription.id, targetInterval)

  if (!orgScoped && isTrialingSubscription(subscription)) return

  const previousInterval = resolveBillingInterval(subscription)
  const target = { ...subscription, plan: targetPlanName, billingInterval: targetInterval }
  const previousBase = orgScoped
    ? getOrgIncludedUsageDollars(subscription)
    : getPlanPricing(subscription).basePrice
  const nextBase = orgScoped ? getOrgIncludedUsageDollars(target) : getPlanPricing(target).basePrice
  const headroomScale =
    previousInterval === targetInterval ? 1 : targetInterval === 'year' ? 12 : 1 / 12

  const rebased = (limit: AnyColumn, creditBalance: AnyColumn) => {
    const previousCovered = sql`${toDecimal(previousBase).toString()}::numeric + ${creditBalance}`
    return sql`case when ${limit} >= ${ON_DEMAND_UNLIMITED} then ${limit} else ${toDecimal(nextBase).toString()}::numeric + ${creditBalance} + greatest(0, coalesce(${limit}, ${previousCovered}) - ${previousCovered}) * ${headroomScale}::numeric end`
  }

  if (orgScoped) {
    await db
      .update(organization)
      .set({
        orgUsageLimit: rebased(organization.orgUsageLimit, organization.creditBalance),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, subscription.referenceId))
  } else {
    await db
      .update(userStats)
      .set({
        currentUsageLimit: rebased(userStats.currentUsageLimit, userStats.creditBalance),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, subscription.referenceId))
  }

  logger.info('Recorded plan switch', {
    subscriptionId: subscription.id,
    fromPlan: subscription.plan,
    toPlan: targetPlanName,
    interval: targetInterval,
    previousBase,
    nextBase,
  })
}
