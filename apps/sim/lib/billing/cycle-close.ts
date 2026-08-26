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
import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { BILLING_LOCK_TIMEOUT_MS } from '@/lib/billing/constants'
import { computeOrgOverageAmount, isSubscriptionOrgScoped } from '@/lib/billing/core/billing'
import { resolveSubscriptionUsagePeriod } from '@/lib/billing/core/reporting-period'
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
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
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

/**
 * Whether this subscription's usage windows derive from an enterprise
 * reporting anchor. Asks the same resolver the usage math uses, so a
 * malformed anchor (hand-edited Stripe metadata) that the resolver rejects —
 * falling back to Stripe bounds — is treated identically here: the ledger
 * rows are stamped with Stripe windows, and the close books them normally.
 */
function usesReportingWindows(sub: {
  plan?: string | null
  billingInterval?: string | null
  metadata?: unknown
  periodStart?: Date | null
  periodEnd?: Date | null
}): boolean {
  return resolveSubscriptionUsagePeriod(sub)?.source === 'reporting'
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
 * Close any elapsed-but-unclosed billing period for a subscription that is
 * being deleted, ahead of its terminal settlement. A deleted subscription
 * leaves the sweep's candidate set (its status leaves
 * `ENTITLED_SUBSCRIPTION_STATUSES`), so this is the last chance to settle a
 * period the sweep has not caught up to — without it, `claimTerminalPeriod`
 * would advance the marker past the elapsed period and silently forgive its
 * final overage, while the elapsed period's threshold collections would
 * wrongly offset the terminal window's. The settlement grace is bypassed:
 * no later sweep will revisit, so straggler rows are forgiven exactly like
 * the terminal settlement's own.
 */
export async function closeElapsedPeriodBeforeDeletion(subscriptionId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(subscriptionTable)
    .where(eq(subscriptionTable.id, subscriptionId))
    .limit(1)
  if (!row?.periodStart) return
  const lagging =
    row.lastClosedPeriodStart === null ||
    row.lastClosedPeriodStart.getTime() < row.periodStart.getTime()
  if (!lagging) return

  const result = await closeElapsedBillingPeriod(row, { bypassSettlementGrace: true })
  if (result.status === 'skipped') {
    // The close deferred (missing Stripe linkage, ownerless org, or a roster
    // change mid-close). Deletion proceeds — blocking member downgrades on an
    // unbillable period is the wrong trade — so the residual overage is
    // forgiven; the close path already logged the specific cause.
    logger.error(
      'Deletion proceeding past an unclosable elapsed period; residual overage forgiven',
      {
        subscriptionId,
        plan: row.plan,
        marker: row.lastClosedPeriodStart?.toISOString() ?? null,
        periodStart: row.periodStart.toISOString(),
      }
    )
  }
}

/**
 * Claim the terminal period for a subscription that is being deleted, BEFORE
 * the deletion handler computes and charges final overage. Reads the
 * subscription row fresh (webhook payloads can be stale across a rollover)
 * and advances the close marker to its current `periodStart` in one
 * transaction, serializing with the sweep on the subscription row: an
 * in-flight sweep close then fails its guarded marker claim and rolls back —
 * including its outbox invoice — so deletion and sweep can never both bill
 * the same period. Call `closeElapsedPeriodBeforeDeletion` first so a lagging
 * elapsed period is settled rather than jumped. Returns the fresh period
 * bounds for the deletion flow to settle against, plus `markerWasCurrent`:
 * whether the close marker had already caught up to the terminal period.
 * The `billedOverageThisPeriod` tracker only ever holds collections for the
 * period that began at the marker (the threshold gate blocks settlement
 * whenever the marker lags), so the terminal settlement must ignore the
 * tracker when the marker was still lagging — its contents belong to a
 * forgiven elapsed period, never to the terminal window.
 *
 * A lagging marker means an elapsed period is still unclosed — either the
 * preceding close deferred, or a rollover committed between that close and
 * this claim. By default the claim then leaves the marker untouched so the
 * caller can run the close again and re-claim; `sealLagging` advances the
 * marker over the unclosed period anyway (logging the forgiveness), which
 * also guarantees an in-flight sweep that selected this subscription before
 * its status changed aborts its own conflicting close.
 */
export async function claimTerminalPeriod(
  subscriptionId: string,
  options: { sealLagging?: boolean } = {}
): Promise<{
  periodStart: Date | null
  periodEnd: Date | null
  markerWasCurrent: boolean
}> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        periodStart: subscriptionTable.periodStart,
        periodEnd: subscriptionTable.periodEnd,
        lastClosedPeriodStart: subscriptionTable.lastClosedPeriodStart,
      })
      .from(subscriptionTable)
      .where(eq(subscriptionTable.id, subscriptionId))
      .for('update')
      .limit(1)

    if (!row?.periodStart) {
      // Mirrors the threshold gate: a null `periodStart` cannot race a
      // rollover, so any tracked collections are legitimately current.
      return { periodStart: null, periodEnd: null, markerWasCurrent: true }
    }
    const markerWasCurrent =
      !!row.lastClosedPeriodStart &&
      row.lastClosedPeriodStart.getTime() >= row.periodStart.getTime()
    if (!markerWasCurrent && options.sealLagging) {
      logger.error(
        'Sealing an unclosed elapsed period at terminal claim; residual overage forgiven',
        {
          subscriptionId,
          marker: row.lastClosedPeriodStart?.toISOString() ?? null,
          periodStart: row.periodStart.toISOString(),
        }
      )
      await claimCloseMarker(tx, subscriptionId, row.periodStart)
    }
    return { periodStart: row.periodStart, periodEnd: row.periodEnd, markerWasCurrent }
  })
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
export async function closeElapsedBillingPeriod(
  sub: SubscriptionRow,
  options: { bypassSettlementGrace?: boolean } = {}
): Promise<CycleCloseResult> {
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

  if (
    !options.bypassSettlementGrace &&
    Date.now() - periodStart.getTime() < CLOSE_SETTLEMENT_GRACE_MS
  ) {
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
    .select({
      // mapWith(column) applies the timestamp decoder — a raw aggregate
      // bypasses column mapping, so the driver would return a string here.
      start: sql<Date | null>`max(${usageLog.billingPeriodStart})`.mapWith(
        usageLog.billingPeriodStart
      ),
    })
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
  if (enterprise && usesReportingWindows(sub)) {
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

  // Final overage for the closed period (enterprise never bills overage).
  // Refresh reads are scoped by the same entity/period stamps as the ledger
  // sums, so a departed member's org-attributed rows offset the overage
  // exactly like a current member's.
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
      })
      totalOverage = computed
    } else {
      const planDollars = getPlanTierDollars(sub.plan)
      let refreshConsumed = 0
      if (planDollars > 0) {
        refreshConsumed = await computeDailyRefreshConsumed({
          billingEntity,
          periodStart: closeFrom,
          periodEnd: periodStart,
          planDollars,
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

      // Canonical lock order: member userStats rows (sorted, so any closers
      // with overlapping row sets acquire locks in one global order — today
      // `member_user_id_unique` keeps org rosters disjoint and other lockers
      // are single-row, so this is deterministic-order hygiene that also
      // holds if membership exclusivity is ever relaxed), then the
      // organization row.
      if (memberIds.length > 0) {
        await tx
          .select({ userId: userStats.userId })
          .from(userStats)
          .where(inArray(userStats.userId, memberIds))
          .orderBy(asc(userStats.userId))
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

        // The tracker's collections belong to the period that began at the
        // marker — the threshold gate blocks settlement whenever the marker
        // lags, so nothing newer can be in it. When this close skipped
        // forgiven periods (`closeFrom` advanced past the marker), those
        // collections offset a forgiven period's overage, not this one's:
        // count nothing against this close. The reset below still clears them.
        const alreadyBilled =
          closeFrom.getTime() === marker.getTime()
            ? toNumber(toDecimal(tracker?.billedOverageThisPeriod))
            : 0
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
 * subscription starts clean. Money is NOT collected here — the deletion
 * handler claims the terminal period via `claimTerminalPeriod` and bills the
 * final overage itself before calling this.
 *
 * Reporting-anchor enterprise subscriptions are skipped: their usage windows
 * derive live from the anchor, and the subscription's Stripe bounds would
 * range the wrong stamped rows.
 */
export async function writeFinalPeriodBookkeeping(sub: {
  id: string
  plan: string | null
  referenceId: string
  billingInterval?: string | null
  periodStart?: Date | null
  periodEnd?: Date | null
  metadata?: unknown
}): Promise<void> {
  if (!sub.periodStart) return
  const periodStart = sub.periodStart

  if (usesReportingWindows(sub)) return

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
  })
}

export interface CycleCloseSweepSummary {
  candidates: number
  closed: number
  initialized: number
  failed: number
}

/**
 * Candidates fetched per page of the sweep's keyset iteration. Bounds sweep
 * memory to one page of subscription rows regardless of fleet size.
 */
const SWEEP_PAGE_SIZE = 250

/**
 * Concurrent closes per page. Closes of different subscriptions are
 * independent transactions; the per-subscription guarded marker claim and the
 * deterministic member-lock ordering make any interleaving safe, so this
 * bound exists only to cap database pressure from one sweep.
 */
const SWEEP_CLOSE_CONCURRENCY = 10

/**
 * Entitled statuses inlined as SQL literals rather than bind parameters: the
 * candidate scan targets the partial index on exactly this predicate, and the
 * planner can only prove a query implies a partial index's predicate from
 * literals — a parameterized generic plan would fall back to scanning the
 * whole table.
 */
const ENTITLED_STATUS_LITERALS = sql.raw(
  ENTITLED_SUBSCRIPTION_STATUSES.map((status) => `'${status}'`).join(', ')
)

/**
 * Daily catch-all that closes every elapsed billing period. Candidates are
 * entitled subscriptions whose close marker lags their current `periodStart`
 * — i.e. the period advanced (via Stripe sync) since the last close.
 *
 * Iterates candidates in keyset pages (matching the partial index on exactly
 * this predicate) and closes each page with bounded concurrency. Each close
 * is independently atomic and error-isolated, so one failure never blocks
 * the rest; a page that closes successfully leaves the candidate set, which
 * also makes an interrupted sweep (deploy, crash) resume where it left off
 * on the next run.
 */
export async function sweepBillingCycleCloses(): Promise<CycleCloseSweepSummary> {
  const summary: CycleCloseSweepSummary = {
    candidates: 0,
    closed: 0,
    initialized: 0,
    failed: 0,
  }
  const startedAt = Date.now()
  let cursor = ''

  while (true) {
    const page = await db
      .select()
      .from(subscriptionTable)
      .where(
        and(
          sql`${subscriptionTable.status} in (${ENTITLED_STATUS_LITERALS})`,
          sql`${subscriptionTable.periodStart} IS NOT NULL`,
          or(
            isNull(subscriptionTable.lastClosedPeriodStart),
            lt(subscriptionTable.lastClosedPeriodStart, subscriptionTable.periodStart)
          ),
          gt(subscriptionTable.id, cursor)
        )
      )
      .orderBy(asc(subscriptionTable.id))
      .limit(SWEEP_PAGE_SIZE)

    if (page.length === 0) break
    summary.candidates += page.length
    cursor = page[page.length - 1].id

    // Total mapper: every close resolves to a status so one failure never
    // rejects the page (mapWithConcurrency is all-or-nothing on rejection).
    const results = await mapWithConcurrency(page, SWEEP_CLOSE_CONCURRENCY, async (sub) => {
      try {
        return (await closeElapsedBillingPeriod(sub)).status
      } catch (error) {
        logger.error('Cycle close failed for subscription', {
          subscriptionId: sub.id,
          plan: sub.plan,
          error: getErrorMessage(error),
        })
        return 'failed' as const
      }
    })
    for (const status of results) {
      if (status === 'closed') summary.closed++
      if (status === 'initialized') summary.initialized++
      if (status === 'failed') summary.failed++
    }

    if (page.length < SWEEP_PAGE_SIZE) break
  }

  logger.info('Billing cycle-close sweep finished', {
    ...summary,
    durationMs: Date.now() - startedAt,
  })
  return summary
}
