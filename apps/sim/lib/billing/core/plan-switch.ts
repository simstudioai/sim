import { db } from '@sim/db'
import { organization, subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { writeBillingInterval } from '@/lib/billing/core/subscription'
import {
  getPlanPricing,
  isTrialingSubscription,
  type PlanPricingInput,
} from '@/lib/billing/subscriptions/utils'
import { toDecimal } from '@/lib/billing/utils/decimal'

const logger = createLogger('PlanSwitch')

interface SwitchedSubscription extends PlanPricingInput {
  id: string
  plan: string
  referenceId: string
  status: string | null
  seats?: number | null
  trialEnd?: Date | null
}

/**
 * Records a tier or billing-interval change Stripe has already applied: the plan, the interval,
 * and the payer's usage limit.
 *
 * A limit the payer never raised sits at the old plan's included usage plus prepaid credit. Left
 * there after a move to a cheaper plan or a monthly interval, it would read as on-demand usage the
 * payer never turned on and bill overage past the new plan's allowance, so it moves to the new
 * plan's included usage. A limit raised above the old allowance was the payer's choice and stays.
 * A trial keeps its fixed allowance.
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

  if (isTrialingSubscription(subscription)) return

  const seats = orgScoped ? subscription.seats || 1 : 1
  const previousBase = toDecimal(getPlanPricing(subscription).basePrice).times(seats).toString()
  const nextBase = toDecimal(
    getPlanPricing({ plan: targetPlanName, billingInterval: targetInterval }).basePrice
  )
    .times(seats)
    .toString()

  if (orgScoped) {
    await db
      .update(organization)
      .set({
        orgUsageLimit: sql`${nextBase}::numeric + ${organization.creditBalance}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organization.id, subscription.referenceId),
          sql`coalesce(${organization.orgUsageLimit}, 0) <= ${previousBase}::numeric + ${organization.creditBalance}`
        )
      )
  } else {
    await db
      .update(userStats)
      .set({
        currentUsageLimit: sql`${nextBase}::numeric + ${userStats.creditBalance}`,
        usageLimitUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(userStats.userId, subscription.referenceId),
          sql`coalesce(${userStats.currentUsageLimit}, 0) <= ${previousBase}::numeric + ${userStats.creditBalance}`
        )
      )
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
