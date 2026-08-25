import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  member,
  organization,
  subscription as subscriptionTable,
  usageLog,
  userStats,
} from '@sim/db/schema'
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
import type { DbOrTx } from '@/lib/db/types'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('BillingCycleClose')

/**
 * Minimum residual overage worth invoicing at cycle close, in dollars.
 * Anything below this is forgiven rather than billed as a sub-cent invoice.
 */
const MIN_CLOSE_INVOICE_DOLLARS = 0.5

/**
 * Settlement grace after a rollover before its elapsed period may close.
 * Billing attribution is frozen at run start (the payer is immutable for the
 * run), so a run that started just before the rollover can insert rows
 * stamped with the elapsed period after it ends. Closing only once the
 * rollover is older than any possible in-flight run guarantees the close's
 * ledger sums are final — no straggler row is orphaned from the final
 * overage or bookkeeping. Non-enterprise execution timeouts are far below
 * this bound; the sweep simply picks the period up on a later run.
 */
const CLOSE_SETTLEMENT_GRACE_MS = 60 * 60 * 1000

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

/** Order-insensitive membership fingerprint for under-lock roster revalidation. */
function rosterSignature(rows: { userId: string; role: string }[]): string {
  return rows
    .map((row) => `${row.userId}:${row.role}`)
    .sort()
    .join('|')
}

function hasEnterpriseReportingAnchor(sub: { plan: string | null; metadata?: unknown }): boolean {
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
 *
 * The same predicate revalidates inside the settlement transaction (pass the
 * `tx` as `executor` plus the `expectedPeriodStart` the overage was computed
 * against): the unlocked preflight leaves a window where a rollover and its
 * close can commit first, so the settlement re-checks under the tracker lock
 * and aborts when the period moved.
 */
export async function isSubscriptionCycleCloseCurrent(
  subscriptionId: string,
  options: { executor?: DbOrTx; expectedPeriodStart?: Date | null } = {}
): Promise<boolean> {
  const executor = options.executor ?? db
  const [row] = await executor
    .select({
      periodStart: subscriptionTable.periodStart,
      lastClosedPeriodStart: subscriptionTable.lastClosedPeriodStart,
    })
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)

  if (options.expectedPeriodStart) {
    if (!row?.periodStart || row.periodStart.getTime() !== options.expectedPeriodStart.getTime()) {
      return false
    }
  } else if (!row?.periodStart) {
    return true
  }

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

  if (Date.now() - periodStart.getTime() < CLOSE_SETTLEMENT_GRACE_MS) {
    // Rollover too recent — a run started before it could still insert rows
    // stamped with the elapsed period. A later sweep closes it with final sums.
    return base
  }

  const marker = sub.lastClosedPeriodStart
  const orgScoped = await isSubscriptionOrgScoped(sub)
  const billingEntity = orgScoped
    ? ({ type: 'organization', id: sub.referenceId } as const)
    : ({ type: 'user', id: sub.referenceId } as const)
  // The elapsed period's exact start, from the ledger's own write-time stamps
  // (its rows carry `billing_period_end == periodStart` — the renewal
  // invariant). Deriving the bound from stamps instead of calendar math keeps
  // the refresh window aligned with the stamped period even when anchor-day
  // drift (e.g. Jan 31 → Feb 28) makes `periodStart - 1 interval` inexact.
  const [prevStamp] = await db
    .select({ start: sql<Date | null>`max(${usageLog.billingPeriodStart})` })
    .from(usageLog)
    .where(
      and(
        eq(usageLog.billingEntityType, billingEntity.type),
        eq(usageLog.billingEntityId, billingEntity.id),
        eq(usageLog.billingPeriodEnd, periodStart)
      )
    )
  const expectedPrevStart = prevStamp?.start ?? minusOneInterval(periodStart, sub.billingInterval)
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

  // Labels use the closed period's END month, matching threshold billing's
  // period-end labeling for overage invoices.
  const billingPeriodLabel = periodStart.toISOString().slice(0, 7)
  const collectMoney = !enterprise && totalOverage > 0
  if (collectMoney && (!sub.stripeCustomerId || !sub.stripeSubscriptionId)) {
    // Claiming the marker here would silently forgive the overage. Defer the
    // whole close — the sweep retries every run until the Stripe linkage is
    // repaired, and this error is the operator signal.
    logger.error('Deferring cycle close: overage due but Stripe identifiers are missing', {
      subscriptionId: sub.id,
      plan: sub.plan,
      totalOverage,
      hasStripeCustomerId: !!sub.stripeCustomerId,
      hasStripeSubscriptionId: !!sub.stripeSubscriptionId,
    })
    return base
  }
  if (collectMoney && orgScoped && !trackerUserId) {
    // Same defer as missing Stripe state: without an owner row there is no
    // billed-overage tracker or credit target, and claiming the marker would
    // silently forgive the overage. The sweep retries once ownership is
    // repaired; mirrors threshold billing's missing-owner handling.
    logger.error('Deferring cycle close: overage due but organization has no owner', {
      subscriptionId: sub.id,
      organizationId: sub.referenceId,
      plan: sub.plan,
      totalOverage,
    })
    return base
  }

  const closeResult = await db.transaction(
    async (
      tx
    ): Promise<{
      status: 'closed' | 'already-closed' | 'membership-changed'
      billed: number
      creditsApplied: number
    }> => {
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

      // Re-read the roster under the locks, mirroring threshold billing: an
      // owner transfer moves `billedOverageThisPeriod` between rows, so a
      // roster read from before the locks could settle against the wrong
      // tracker or reset a stale member set. The sweep simply retries.
      if (orgScoped) {
        const lockedRoster = await tx
          .select({ userId: member.userId, role: member.role })
          .from(member)
          .where(eq(member.organizationId, sub.referenceId))
        if (rosterSignature(lockedRoster) !== rosterSignature(memberRows)) {
          return { status: 'membership-changed', billed: 0, creditsApplied: 0 }
        }
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
  if (closeResult.status === 'membership-changed') {
    logger.info('Deferring cycle close: organization membership changed mid-close', {
      subscriptionId: sub.id,
      organizationId: sub.referenceId,
    })
    return base
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
 * stamped ledger sums, clears the per-period trackers so a future
 * subscription starts clean, and claims the close marker for the terminal
 * period in the same transaction so an in-flight sweep close cannot land
 * after it and re-bill overage the deletion handler already settled (the two
 * paths serialize on the member userStats locks, and the loser's marker
 * re-check aborts it). Money is NOT collected here — the deletion handler
 * bills the final overage itself before calling this.
 *
 * Reporting-anchor enterprise subscriptions are skipped entirely except for
 * the marker claim: their usage windows derive live from the anchor, and the
 * subscription's Stripe bounds would range the wrong stamped rows.
 */
export async function writeFinalPeriodBookkeeping(sub: {
  id: string
  plan: string | null
  referenceId: string
  periodStart?: Date | null
  periodEnd?: Date | null
  metadata?: unknown
}): Promise<void> {
  if (!sub.periodStart) return
  const periodStart = sub.periodStart

  if (hasEnterpriseReportingAnchor(sub)) {
    await db.transaction(async (tx) => claimCloseMarker(tx, sub.id, periodStart))
    return
  }

  const orgScoped = await isSubscriptionOrgScoped(sub)
  const billingEntity = orgScoped
    ? ({ type: 'organization', id: sub.referenceId } as const)
    : ({ type: 'user', id: sub.referenceId } as const)
  const range = { from: periodStart, to: sub.periodEnd ?? new Date() }

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
    // Claim the terminal period's marker with the tracker reset: an in-flight
    // sweep close for the elapsed period now fails its under-lock marker
    // re-check and rolls back instead of re-billing settled overage. If the
    // close already committed, this claim is a guarded no-op.
    await claimCloseMarker(tx, sub.id, periodStart)
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
