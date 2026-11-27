import { db } from '@sim/db'
import { organization, subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { type AnyColumn, eq, type SQL, sql } from 'drizzle-orm'
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
 *
 * `previous` is the pool read before Stripe applied the change ({@link readSwitchBasis}).
 * Given it, the headroom comes from that limit and that credit balance, so neither a webhook that
 * raised the live limit first nor credit granted meanwhile changes the headroom the payer chose;
 * a snapshot predates any webhook, so a limit in it at the new amount is chosen headroom.
 */
export async function rebaseUsageLimit(
  params: {
    pool: { type: 'user' | 'organization'; id: string }
    previousIncluded: number
    nextIncluded: number
    headroomScale?: number
    previous?: PoolUsageSnapshot
  },
  executor: DbOrTx = db
): Promise<void> {
  const { pool, previousIncluded, nextIncluded, headroomScale = 1, previous } = params
  const covered = (included: number, credit: SQL) =>
    sql`(${toDecimal(included).toString()}::numeric + ${credit})`
  const rebased = (limit: AnyColumn, creditBalance: AnyColumn) => {
    const before = previous ? sql`${previous.limit}::numeric` : sql`${limit}`
    const creditBefore = previous ? sql`${previous.creditBalance}::numeric` : sql`${creditBalance}`
    const previousCovered = covered(previousIncluded, creditBefore)
    const chosen = sql`greatest(0, coalesce(${before}, ${previousCovered}) - ${previousCovered})`
    const headroom = previous
      ? chosen
      : sql`case when ${limit} = ${covered(nextIncluded, sql`${creditBalance}`)} then 0 else ${chosen} end`
    return sql`case when ${before} >= ${ON_DEMAND_UNLIMITED} then ${before} else round(${covered(nextIncluded, sql`${creditBalance}`)} + ${headroom} * ${headroomScale}::numeric, 2) end`
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

/** A usage pool's limit and prepaid credit as stored, read together before a plan switch. */
export interface PoolUsageSnapshot {
  limit: string | null
  creditBalance: string
}

/** What a plan switch computes from: the subscription and its usage pool, read in one snapshot. */
export interface SwitchBasis {
  subscription: typeof subscriptionTable.$inferSelect
  pool: PoolUsageSnapshot | undefined
}

/**
 * Reads a plan switch's {@link SwitchBasis} under its admission claim, in one snapshot. Null when
 * the plan or interval no longer matches `basis`: a switch that finished between this request's
 * first read and its claim moved it, and computing from the stale read would count the new
 * allowance as headroom the payer chose. A seat sync takes no claim, so the seats and allowance
 * come from this read too, consistent with the pool limit they produced.
 */
export async function readSwitchBasis(
  basis: SwitchedSubscription,
  pool: { type: 'user' | 'organization'; id: string }
): Promise<SwitchBasis | null> {
  return db.transaction(
    async (tx) => {
      const [current] = await tx
        .select()
        .from(subscriptionTable)
        .where(eq(subscriptionTable.id, basis.id))
        .limit(1)
      if (
        !current ||
        current.plan !== basis.plan ||
        resolveBillingInterval(current) !== resolveBillingInterval(basis)
      ) {
        return null
      }
      const [poolRow] =
        pool.type === 'organization'
          ? await tx
              .select({
                limit: organization.orgUsageLimit,
                creditBalance: organization.creditBalance,
              })
              .from(organization)
              .where(eq(organization.id, pool.id))
              .limit(1)
          : await tx
              .select({
                limit: userStats.currentUsageLimit,
                creditBalance: userStats.creditBalance,
              })
              .from(userStats)
              .where(eq(userStats.userId, pool.id))
              .limit(1)
      return { subscription: current, pool: poolRow }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}

/**
 * Records a tier or billing-interval change Stripe has already applied: the plan, the interval,
 * and the payer's usage limit.
 *
 * The limit moves with the plan's included usage ({@link rebaseUsageLimit}): an untouched limit
 * left at a pricier allowance would read as on-demand usage nobody turned on. A personal trial
 * keeps its fixed allowance.
 *
 * An interval change also restarts Stripe's period, which `period` carries from the update. It is
 * written with the interval: until the subscription webhook lands, the old period with the new
 * interval would price a year of usage against a month's allowance, and threshold billing would
 * collect overage the old year's close then finds it never owed.
 */
export async function recordPlanSwitch(params: {
  subscription: SwitchedSubscription
  targetPlanName: string
  targetInterval: 'month' | 'year'
  orgScoped: boolean
  period?: { start: Date; end: Date }
  previous?: PoolUsageSnapshot
}): Promise<void> {
  const { subscription, targetPlanName, targetInterval, orgScoped, period, previous } = params

  const trialing = !orgScoped && isTrialingSubscription(subscription)
  const previousInterval = resolveBillingInterval(subscription)
  const restartedPeriod = previousInterval !== targetInterval ? period : undefined
  const target = {
    ...subscription,
    plan: targetPlanName,
    billingInterval: targetInterval,
    ...(restartedPeriod ? { periodStart: restartedPeriod.start } : {}),
  }
  const previousBase = orgScoped
    ? getOrgIncludedUsageDollars(subscription)
    : getPlanPricing(subscription).basePrice
  const nextBase = orgScoped ? getOrgIncludedUsageDollars(target) : getPlanPricing(target).basePrice
  const headroomScale =
    previousInterval === targetInterval ? 1 : targetInterval === 'year' ? 12 : 1 / 12

  // One transaction: a retry of a half-recorded switch finds the plan already matching and would
  // never rebase the limit.
  await db.transaction(async (tx) => {
    if (subscription.plan !== targetPlanName || restartedPeriod) {
      await tx
        .update(subscriptionTable)
        .set({
          plan: targetPlanName,
          ...(restartedPeriod
            ? { periodStart: restartedPeriod.start, periodEnd: restartedPeriod.end }
            : {}),
        })
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
        previous,
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
