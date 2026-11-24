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
 * Moves a usage pool's limit from one included-usage amount to another. A limit at or below what
 * either amount covers (with prepaid credit) lands on the new one, so an untouched limit never
 * reads as on-demand usage nobody turned on, even when a webhook already raised it to the new
 * amount. A limit raised above both keeps that headroom, scaled by `headroomScale` (an interval
 * change turns a year's headroom into a month's twelfth). An unlimited limit stays unlimited.
 */
export async function rebaseUsageLimit(params: {
  pool: { type: 'user' | 'organization'; id: string }
  previousIncluded: number
  nextIncluded: number
  headroomScale?: number
}): Promise<void> {
  const { pool, previousIncluded, nextIncluded, headroomScale = 1 } = params
  const rebased = (limit: AnyColumn, creditBalance: AnyColumn) => {
    const covered = sql`(${toDecimal(Math.max(previousIncluded, nextIncluded)).toString()}::numeric + ${creditBalance})`
    const headroom = sql`greatest(0, coalesce(${limit}, ${covered}) - ${covered})`
    return sql`case when ${limit} >= ${ON_DEMAND_UNLIMITED} then ${limit} else ${toDecimal(nextIncluded).toString()}::numeric + ${creditBalance} + ${headroom} * ${headroomScale}::numeric end`
  }

  if (pool.type === 'organization') {
    await db
      .update(organization)
      .set({
        orgUsageLimit: rebased(organization.orgUsageLimit, organization.creditBalance),
        updatedAt: new Date(),
      })
      .where(eq(organization.id, pool.id))
  } else {
    await db
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

  await rebaseUsageLimit({
    pool: orgScoped
      ? { type: 'organization', id: subscription.referenceId }
      : { type: 'user', id: subscription.referenceId },
    previousIncluded: previousBase,
    nextIncluded: nextBase,
    headroomScale,
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
