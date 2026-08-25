import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, subscription as subscriptionTable, userStats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { BILLING_LOCK_TIMEOUT_MS } from '@/lib/billing/constants'
import { computeOrgOverageAmount, isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY } from '@/lib/billing/core/reporting-period'
import {
  COPILOT_USAGE_SOURCES,
  getStampedPeriodRangeUsageCostByUser,
} from '@/lib/billing/core/usage-log'
import { computeDailyRefreshConsumed } from '@/lib/billing/credits/daily-refresh'
import { getPlanTierDollars, isEnterprise, isFree } from '@/lib/billing/plan-helpers'
import { ENTITLED_SUBSCRIPTION_STATUSES, getPlanPricing } from '@/lib/billing/subscriptions/utils'
import { toDecimal, toNumber } from '@/lib/billing/utils/decimal'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-handlers'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('BillingCycleClose')

/**
 * Minimum residual overage worth invoicing at cycle close, in dollars.
 * Anything below this is forgiven rather than billed as a sub-cent invoice.
 */
const MIN_CLOSE_INVOICE_DOLLARS = 0.5

type SubscriptionRow = typeof subscriptionTable.$inferSelect

export type CycleCloseStatus = 'initialized' | 'current' | 'closed' | 'already-closed' | 'skipped'

export interface CycleCloseResult {
  status: CycleCloseStatus
  subscriptionId: string
  overageBilled?: number
  creditsApplied?: number
}

/**
 * Subtract one billing interval from a period boundary. Mirrors Stripe's
 * anchor-day semantics closely enough for a close window: the ledger rows are
 * matched by their write-time period stamps, so this bound only needs to
 * enclose the closed period, not reproduce it exactly.
 */
function minusOneInterval(date: Date, billingInterval: string | null): Date {
  const result = new Date(date.getTime())
  if (billingInterval === 'year') {
    result.setUTCFullYear(result.getUTCFullYear() - 1)
  } else {
    result.setUTCMonth(result.getUTCMonth() - 1)
  }
  return result
}

function hasEnterpriseReportingAnchor(sub: SubscriptionRow): boolean {
  return (
    isEnterprise(sub.plan) &&
    isRecordLike(sub.metadata) &&
    typeof sub.metadata[ENTERPRISE_REPORTING_PERIOD_ANCHOR_METADATA_KEY] === 'string'
  )
}

/**
 * Whether a subscription's previous period has already been closed — i.e. the
 * durable close marker has caught up to the current `periodStart`.
 *
 * Threshold billing gates on this so the shared `billedOverageThisPeriod`
 * tracker never mixes periods: after a rollover but before the sweep closes
 * the elapsed period, a new-period settlement would be subtracted from the
 * elapsed period's final overage and then wiped by the close's tracker reset,
 * under-billing one period and double-billing the other. Skipping settlement
 * until the close lands (sweep cadence, ≤6h) removes the race; a null marker
 * (pre-first-sweep) also gates, and a null `periodStart` cannot race at all.
 */
export async function isSubscriptionCycleCloseCurrent(subscriptionId: string): Promise<boolean> {
  const [row] = await db
    .select({
      periodStart: subscriptionTable.periodStart,
      lastClosedPeriodStart: subscriptionTable.lastClosedPeriodStart,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)

  if (!row?.periodStart) return true
  return (
    row.lastClosedPeriodStart !== null &&
    row.lastClosedPeriodStart.getTime() >= row.periodStart.getTime()
  )
}

/**
 * Advance the durable close marker to `periodStart`, guarded so concurrent
 * closers and replays collapse to one winner. Returns false when another
 * worker already advanced the marker at or past this boundary.
 */
async function claimCloseMarker(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  subscriptionId: string,
  periodStart: Date
): Promise<boolean> {
  const claimed = await tx
    .update(subscriptionTable)
    .set({ lastClosedPeriodStart: periodStart })
    .where(
      and(
        eq(subscriptionTable.id, subscriptionId),
        or(
          isNull(subscriptionTable.lastClosedPeriodStart),
          lt(subscriptionTable.lastClosedPeriodStart, periodStart)
        )
      )
    )
    .returning({ id: subscriptionTable.id })
  return claimed.length > 0
}

/**
 * Close the most recently elapsed billing period for one subscription.
 *
 * Runs when the durable `lastClosedPeriodStart` marker lags the subscription's
 * current `periodStart` (better-auth advances the row's period from Stripe's
 * `customer.subscription.updated`). The close, per closed period:
 *
 * 1. Sums the closed period's ledger usage per member from write-time period
 *    stamps (`getStampedPeriodRangeUsageCostByUser`) — never `created_at`.
 * 2. Collects final sub-threshold overage for non-enterprise plans: computed
 *    overage minus what threshold billing already collected
 *    (`billedOverageThisPeriod`), credits applied first, remainder invoiced
 *    through the transaction-enlisted Stripe outbox with deterministic
 *    idempotency stems keyed by `(subscriptionId, closed period)`.
 * 3. Writes `lastPeriodCost` / `lastPeriodCopilotCost` bookkeeping from the
 *    same ledger sums and resets `billedOverageThisPeriod` for the new period.
 * 4. Advances the marker in the same transaction, so the money, bookkeeping,
 *    and marker commit atomically — a crash retries the whole close, and the
 *    outbox's Stripe idempotency keys collapse invoice replays.
 *
 * Enterprise subscriptions never collect money here (billing is contractual,
 * outside Stripe); they get bookkeeping + marker only, and orgs on reporting
 * anchors skip bookkeeping too because their windows derive live from the
 * anchor. A null marker initializes to the current `periodStart` without
 * billing, so historical periods are never retroactively closed.
 */
export async function closeElapsedBillingPeriod(sub: SubscriptionRow): Promise<CycleCloseResult> {
  const base: CycleCloseResult = { status: 'skipped', subscriptionId: sub.id }

  if (!sub.periodStart || isFree(sub.plan)) return base
  const periodStart = sub.periodStart

  if (sub.lastClosedPeriodStart && sub.lastClosedPeriodStart.getTime() >= periodStart.getTime()) {
    return { ...base, status: 'current' }
  }

  if (!sub.lastClosedPeriodStart) {
    await db
      .update(subscriptionTable)
      .set({ lastClosedPeriodStart: periodStart })
      .where(and(eq(subscriptionTable.id, sub.id), isNull(subscriptionTable.lastClosedPeriodStart)))
    logger.info('Initialized cycle-close marker without billing', {
      subscriptionId: sub.id,
      plan: sub.plan,
      periodStart: periodStart.toISOString(),
    })
    return { ...base, status: 'initialized' }
  }

  const marker = sub.lastClosedPeriodStart
  const expectedPrevStart = minusOneInterval(periodStart, sub.billingInterval)
  // Money and bookkeeping cover exactly one period. A marker further back
  // than one interval means missed sweeps; those older periods' sub-threshold
  // tails are forgiven (loudly) rather than billed with multi-period math.
  const closeFrom = marker.getTime() < expectedPrevStart.getTime() ? expectedPrevStart : marker
  if (closeFrom.getTime() !== marker.getTime()) {
    logger.error('Cycle close skipped elapsed periods; forgiving their residual overage', {
      subscriptionId: sub.id,
      plan: sub.plan,
      marker: marker.toISOString(),
      closingFrom: closeFrom.toISOString(),
      periodStart: periodStart.toISOString(),
    })
  }
  if (closeFrom.getTime() >= periodStart.getTime()) {
    // Degenerate window (clock skew or a shortened period) — just advance.
    const advanced = await db.transaction(async (tx) => claimCloseMarker(tx, sub.id, periodStart))
    return { ...base, status: advanced ? 'closed' : 'already-closed' }
  }

  const orgScoped = await isSubscriptionOrgScoped(sub)
  const billingEntity = orgScoped
    ? ({ type: 'organization', id: sub.referenceId } as const)
    : ({ type: 'user', id: sub.referenceId } as const)
  const closedRange = { from: closeFrom, to: periodStart }

  const enterprise = isEnterprise(sub.plan)
  if (enterprise && hasEnterpriseReportingAnchor(sub)) {
    // Reporting-anchor orgs derive every usage window live from the anchor;
    // there is nothing to bill or book here. Advance the marker so the sweep
    // stays quiet.
    const advanced = await db.transaction(async (tx) => claimCloseMarker(tx, sub.id, periodStart))
    return { ...base, status: advanced ? 'closed' : 'already-closed' }
  }

  const [usageByUser, copilotByUser] = await Promise.all([
    getStampedPeriodRangeUsageCostByUser(billingEntity, closedRange),
    getStampedPeriodRangeUsageCostByUser(billingEntity, closedRange, COPILOT_USAGE_SOURCES),
  ])
  let closedLedgerUsage = 0
  for (const cost of usageByUser.values()) closedLedgerUsage += cost

  const memberRows = orgScoped
    ? await db
        .select({ userId: member.userId, role: member.role })
        .from(member)
        .where(eq(member.organizationId, sub.referenceId))
    : []
  const memberIds = orgScoped ? memberRows.map((row) => row.userId) : [sub.referenceId]
  const trackerUserId = orgScoped
    ? (memberRows.find((row) => row.role === 'owner')?.userId ?? null)
    : sub.referenceId
  // Every actor whose org-attributed usage is billed at this close, including
  // members who departed mid-period: their ledger rows stay stamped to this
  // organization's period, so their daily-refresh consumption must offset the
  // overage exactly like a current member's. Current members with no rows stay
  // in the set for their refresh bounds.
  const overageActorIds = orgScoped
    ? [...new Set([...memberIds, ...usageByUser.keys()])]
    : memberIds

  // Final overage for the closed period (enterprise never bills overage).
  let totalOverage = 0
  if (!enterprise) {
    if (orgScoped) {
      const { totalOverage: computed } = await computeOrgOverageAmount({
        plan: sub.plan,
        seats: sub.seats ?? null,
        periodStart: closeFrom,
        periodEnd: periodStart,
        organizationId: sub.referenceId,
        pooledLedgerUsage: closedLedgerUsage,
        memberIds: overageActorIds,
      })
      totalOverage = computed
    } else {
      const planDollars = getPlanTierDollars(sub.plan)
      let refreshConsumed = 0
      if (planDollars > 0) {
        refreshConsumed = await computeDailyRefreshConsumed({
          userIds: [sub.referenceId],
          periodStart: closeFrom,
          periodEnd: periodStart,
          planDollars,
          billingEntity,
        })
      }
      const { basePrice } = getPlanPricing(sub.plan)
      totalOverage = Math.max(0, closedLedgerUsage - refreshConsumed - basePrice)
    }
  }

  const billingPeriodLabel = closeFrom.toISOString().slice(0, 7)
  const collectMoney =
    !enterprise && totalOverage > 0 && !!sub.stripeCustomerId && !!sub.stripeSubscriptionId

  const closeResult = await db.transaction(
    async (
      tx
    ): Promise<{ status: 'closed' | 'already-closed'; billed: number; creditsApplied: number }> => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${BILLING_LOCK_TIMEOUT_MS}ms'`))

      // Canonical lock order: member userStats rows, then the organization row.
      if (memberIds.length > 0) {
        await tx
          .select({ userId: userStats.userId })
          .from(userStats)
          .where(inArray(userStats.userId, memberIds))
          .for('update')
      }
      let orgCreditBalance = 0
      if (orgScoped) {
        const [orgRow] = await tx
          .select({ creditBalance: organization.creditBalance })
          .from(organization)
          .where(eq(organization.id, sub.referenceId))
          .for('update')
          .limit(1)
        orgCreditBalance = toNumber(toDecimal(orgRow?.creditBalance))
      }

      // Re-check the marker under the locks: a concurrent closer that already
      // committed makes this a no-op (its billedOverage reset must not be
      // mistaken for unbilled overage).
      const [current] = await tx
        .select({ lastClosedPeriodStart: subscriptionTable.lastClosedPeriodStart })
        .from(subscriptionTable)
        .where(eq(subscriptionTable.id, sub.id))
        .limit(1)
      if (
        current?.lastClosedPeriodStart &&
        current.lastClosedPeriodStart.getTime() >= periodStart.getTime()
      ) {
        return { status: 'already-closed', billed: 0, creditsApplied: 0 }
      }

      let billed = 0
      let creditsApplied = 0

      if (collectMoney && trackerUserId) {
        const [tracker] = await tx
          .select({
            billedOverageThisPeriod: userStats.billedOverageThisPeriod,
            creditBalance: userStats.creditBalance,
          })
          .from(userStats)
          .where(eq(userStats.userId, trackerUserId))
          .limit(1)

        const alreadyBilled = toNumber(toDecimal(tracker?.billedOverageThisPeriod))
        let remaining = Math.max(0, totalOverage - alreadyBilled)

        if (remaining > 0) {
          const creditBalance = orgScoped
            ? orgCreditBalance
            : toNumber(toDecimal(tracker?.creditBalance))
          if (creditBalance > 0) {
            creditsApplied = Math.min(creditBalance, remaining)
            if (orgScoped) {
              await tx
                .update(organization)
                .set({
                  creditBalance: sql`GREATEST(0, ${organization.creditBalance} - ${creditsApplied})`,
                })
                .where(eq(organization.id, sub.referenceId))
            } else {
              await tx
                .update(userStats)
                .set({
                  creditBalance: sql`GREATEST(0, ${userStats.creditBalance} - ${creditsApplied})`,
                })
                .where(eq(userStats.userId, trackerUserId))
            }
            remaining -= creditsApplied
          }

          if (remaining >= MIN_CLOSE_INVOICE_DOLLARS) {
            const amountCents = Math.round(remaining * 100)
            const idemStem = `cycle-close-overage:${sub.id}:${periodStart.toISOString()}`
            await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE, {
              customerId: sub.stripeCustomerId,
              stripeSubscriptionId: sub.stripeSubscriptionId,
              amountCents,
              description: `Final overage billing – ${billingPeriodLabel}`,
              itemDescription: `Usage overage ($${remaining.toFixed(2)})`,
              billingPeriod: billingPeriodLabel,
              invoiceIdemKeyStem: `${idemStem}:invoice`,
              itemIdemKeyStem: `${idemStem}:item`,
              metadata: {
                type: 'overage_billing',
                subscriptionId: sub.stripeSubscriptionId ?? '',
                billingPeriod: billingPeriodLabel,
                ...(orgScoped ? { organizationId: sub.referenceId } : { userId: sub.referenceId }),
              },
            })
            billed = remaining
          } else if (remaining > 0) {
            logger.info('Forgiving sub-minimum cycle-close overage', {
              subscriptionId: sub.id,
              remaining,
            })
          }
        }
      }

      // Bookkeeping: previous-period totals from the same stamped ledger sums.
      if (memberIds.length > 0) {
        const lastCostCases = sql.join(
          memberIds.map(
            (userId) => sql`WHEN ${userId} THEN ${(usageByUser.get(userId) ?? 0).toString()}`
          ),
          sql` `
        )
        const lastCopilotCases = sql.join(
          memberIds.map(
            (userId) => sql`WHEN ${userId} THEN ${(copilotByUser.get(userId) ?? 0).toString()}`
          ),
          sql` `
        )
        await tx
          .update(userStats)
          .set({
            lastPeriodCost: sql`CASE ${userStats.userId} ${lastCostCases} ELSE ${userStats.lastPeriodCost} END`,
            lastPeriodCopilotCost: sql`CASE ${userStats.userId} ${lastCopilotCases} ELSE ${userStats.lastPeriodCopilotCost} END`,
            billedOverageThisPeriod: '0',
          })
          .where(inArray(userStats.userId, memberIds))
      }
      if (orgScoped) {
        await tx
          .update(organization)
          .set({ departedMemberUsage: '0' })
          .where(eq(organization.id, sub.referenceId))
      }

      const advanced = await claimCloseMarker(tx, sub.id, periodStart)
      if (!advanced) {
        throw new Error(
          `Cycle-close marker for subscription ${sub.id} advanced concurrently; rolling back`
        )
      }

      return { status: 'closed', billed, creditsApplied }
    }
  )

  if (closeResult.status === 'already-closed') {
    return { ...base, status: 'already-closed' }
  }

  logger.info('Closed billing period', {
    subscriptionId: sub.id,
    plan: sub.plan,
    orgScoped,
    closedFrom: closeFrom.toISOString(),
    closedTo: periodStart.toISOString(),
    closedLedgerUsage,
    totalOverage,
    overageBilled: closeResult.billed,
    creditsApplied: closeResult.creditsApplied,
  })

  if (closeResult.billed > 0 || closeResult.creditsApplied > 0) {
    const actorId = trackerUserId ?? sub.referenceId
    const settledVia = closeResult.billed > 0 ? 'stripe' : 'credits'
    recordAudit({
      actorId,
      action: AuditAction.OVERAGE_BILLED,
      resourceType: AuditResourceType.BILLING,
      resourceId: sub.id,
      description: `Final overage of $${(closeResult.billed + closeResult.creditsApplied).toFixed(2)} settled at cycle close for ${sub.referenceId}`,
      metadata: {
        entityType: billingEntity.type,
        referenceId: sub.referenceId,
        ...(orgScoped ? { organizationId: sub.referenceId } : {}),
        plan: sub.plan,
        amount: closeResult.billed + closeResult.creditsApplied,
        currency: 'usd',
        creditsApplied: closeResult.creditsApplied,
        settledVia,
        billingPeriod: billingPeriodLabel,
      },
    })
    captureServerEvent(actorId, 'overage_billed', {
      amount: closeResult.billed + closeResult.creditsApplied,
      currency: 'usd',
      entity_type: billingEntity.type,
      reference_id: sub.referenceId,
      settled_via: settledVia,
    })
  }

  return {
    ...base,
    status: 'closed',
    overageBilled: closeResult.billed,
    creditsApplied: closeResult.creditsApplied,
  }
}

/**
 * Terminal bookkeeping for a subscription that is ending (deleted/cancelled):
 * writes `lastPeriodCost` / `lastPeriodCopilotCost` from the final period's
 * stamped ledger sums and clears the per-period trackers so a future
 * subscription starts clean. Money is NOT collected here — the deletion
 * handler bills the final overage itself before calling this.
 */
export async function writeFinalPeriodBookkeeping(sub: {
  plan: string | null
  referenceId: string
  periodStart?: Date | null
  periodEnd?: Date | null
}): Promise<void> {
  if (!sub.periodStart) return
  const orgScoped = await isSubscriptionOrgScoped(sub)
  const billingEntity = orgScoped
    ? ({ type: 'organization', id: sub.referenceId } as const)
    : ({ type: 'user', id: sub.referenceId } as const)
  const range = { from: sub.periodStart, to: sub.periodEnd ?? new Date() }

  const [usageByUser, copilotByUser] = await Promise.all([
    getStampedPeriodRangeUsageCostByUser(billingEntity, range),
    getStampedPeriodRangeUsageCostByUser(billingEntity, range, COPILOT_USAGE_SOURCES),
  ])

  const memberIds = orgScoped
    ? (
        await db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, sub.referenceId))
      ).map((row) => row.userId)
    : [sub.referenceId]

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${BILLING_LOCK_TIMEOUT_MS}ms'`))
    if (memberIds.length > 0) {
      const lastCostCases = sql.join(
        memberIds.map(
          (userId) => sql`WHEN ${userId} THEN ${(usageByUser.get(userId) ?? 0).toString()}`
        ),
        sql` `
      )
      const lastCopilotCases = sql.join(
        memberIds.map(
          (userId) => sql`WHEN ${userId} THEN ${(copilotByUser.get(userId) ?? 0).toString()}`
        ),
        sql` `
      )
      await tx
        .update(userStats)
        .set({
          lastPeriodCost: sql`CASE ${userStats.userId} ${lastCostCases} ELSE ${userStats.lastPeriodCost} END`,
          lastPeriodCopilotCost: sql`CASE ${userStats.userId} ${lastCopilotCases} ELSE ${userStats.lastPeriodCopilotCost} END`,
          billedOverageThisPeriod: '0',
        })
        .where(inArray(userStats.userId, memberIds))
    }
    if (orgScoped) {
      await tx
        .update(organization)
        .set({ departedMemberUsage: '0' })
        .where(eq(organization.id, sub.referenceId))
    }
  })
}

export interface CycleCloseSweepSummary {
  candidates: number
  closed: number
  initialized: number
  failed: number
}

/**
 * Daily catch-all that closes every elapsed billing period. Candidates are
 * entitled subscriptions whose close marker lags their current `periodStart`
 * — i.e. the period advanced (via Stripe sync) since the last close. Each
 * close is independently atomic, so one failure never blocks the rest.
 */
export async function sweepBillingCycleCloses(): Promise<CycleCloseSweepSummary> {
  const candidates = await db
    .select()
    .from(subscriptionTable)
    .where(
      and(
        inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sql`${subscriptionTable.periodStart} IS NOT NULL`,
        or(
          isNull(subscriptionTable.lastClosedPeriodStart),
          lt(subscriptionTable.lastClosedPeriodStart, subscriptionTable.periodStart)
        )
      )
    )

  const summary: CycleCloseSweepSummary = {
    candidates: candidates.length,
    closed: 0,
    initialized: 0,
    failed: 0,
  }

  for (const sub of candidates) {
    try {
      const result = await closeElapsedBillingPeriod(sub)
      if (result.status === 'closed') summary.closed++
      if (result.status === 'initialized') summary.initialized++
    } catch (error) {
      summary.failed++
      logger.error('Cycle close failed for subscription', {
        subscriptionId: sub.id,
        plan: sub.plan,
        error: getErrorMessage(error),
      })
    }
  }

  logger.info('Billing cycle-close sweep finished', { ...summary })
  return summary
}
