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
import type { DbOrTx } from '@/lib/db/types'

const logger = createLogger('PlanSwitch')

interface SwitchedSubscription extends OrgAllowanceInput {
  id: string
  plan: string
  referenceId: string
  status: string | null
  trialEnd?: Date | null
}

/**
 * Moves a usage pool's limit from one included-usage amount to another. The on-demand headroom
 * the payer chose above the old amount (with prepaid credit) carries over, scaled by
 * `headroomScale` (an interval change turns a year's headroom into a month's twelfth), so an
 * untouched limit lands on the new amount and never reads as on-demand usage nobody turned on. A
 * limit already at the new amount is untouched too: the Stripe webhook's floor sync can raise it
 * there first. An unlimited limit stays unlimited.
 */
export async function rebaseUsageLimit(
  params: {
    pool: { type: 'user' | 'organization'; id: string }
    previousIncluded: number
    nextIncluded: number
    headroomScale?: number
  },
  executor: DbOrTx = db
): Promise<void> {
  const { pool, previousIncluded, nextIncluded, headroomScale = 1 } = params
  const rebased = (limit: AnyColumn, creditBalance: AnyColumn) => {
    const previousCovered = sql`(${toDecimal(previousIncluded).toString()}::numeric + ${creditBalance})`
    const nextCovered = sql`(${toDecimal(nextIncluded).toString()}::numeric + ${creditBalance})`
    const headroom = sql`case when ${limit} = ${nextCovered} then 0 else greatest(0, coalesce(${limit}, ${previousCovered}) - ${previousCovered}) end`
    return sql`case when ${limit} >= ${ON_DEMAND_UNLIMITED} then ${limit} else ${nextCovered} + ${headroom} * ${headroomScale}::numeric end`
  }

  if (pool.type === 'organization') {
    await executor
      .update(organization)
      .set({
        orgUsageLimit: rebased(organization.orgUsageLimit, organization.creditBalance),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, pool.id))
  } else {
    await executor
      .update(userStats)
      .set({
        currentUsageLimit: rebased(userStats.currentUsageLimit, userStats.creditBalance),
        usageLimitUpdatedAt: new Date(),
      })
      .where(eq(userStats.userId, pool.id))
  }
}

/**
 * Records a tier or billing-interval change Stripe has already applied: the plan, the interval,
 * and the payer's usage limit.
 *
 * The limit moves with the plan's included usage ({@link rebaseUsageLimit}): an untouched limit
 * left at a pricier allowance would read as on-demand usage nobody turned on. A personal trial
 * keeps its fixed allowance.
 */
export async function recordPlanSwitch(params: {
  subscription: SwitchedSubscription
  targetPlanName: string
  targetInterval: 'month' | 'year'
  orgScoped: boolean
}): Promise<void> {
  const { subscription, targetPlanName, targetInterval, orgScoped } = params

  const trialing = !orgScoped && isTrialingSubscription(subscription)
  const previousInterval = resolveBillingInterval(subscription)
  const target = { ...subscription, plan: targetPlanName, billingInterval: targetInterval }
  const previousBase = orgScoped
    ? getOrgIncludedUsageDollars(subscription)
    : getPlanPricing(subscription).basePrice
  const nextBase = orgScoped ? getOrgIncludedUsageDollars(target) : getPlanPricing(target).basePrice
  const headroomScale =
    previousInterval === targetInterval ? 1 : targetInterval === 'year' ? 12 : 1 / 12

  // One transaction: a retry of a half-recorded switch finds the plan already matching and would
  // never rebase the limit.
  await db.transaction(async (tx) => {
    if (subscription.plan !== targetPlanName) {
      await tx
        .update(subscriptionTable)
        .set({ plan: targetPlanName })
        .where(eq(subscriptionTable.id, subscription.id))
    }
    await writeBillingInterval(subscription.id, targetInterval, tx)
    if (trialing) return
    await rebaseUsageLimit(
      {
        pool: orgScoped
          ? { type: 'organization', id: subscription.referenceId }
          : { type: 'user', id: subscription.referenceId },
        previousIncluded: previousBase,
        nextIncluded: nextBase,
        headroomScale,
      },
      tx
    )
  })

  logger.info('Recorded plan switch', {
    subscriptionId: subscription.id,
    fromPlan: subscription.plan,
    toPlan: targetPlanName,
    interval: targetInterval,
    previousBase,
    nextBase,
  })
}
