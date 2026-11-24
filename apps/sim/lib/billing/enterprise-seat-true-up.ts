import { db } from '@sim/db'
import { enterpriseSeatTrueUp, member, subscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, count, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  isEnterpriseSelfServe,
} from '@/lib/billing/subscriptions/utils'
import { parseEnterpriseSubscriptionMetadata } from '@/lib/billing/types'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'

const logger = createLogger('EnterpriseSeatTrueUp')

/** Annual contracts true up each quarter; a monthly contract trues up each term. */
const ANNUAL_TRUE_UP_WINDOW_MONTHS = 3

export interface SeatTrueUpWindow {
  start: Date
  end: Date
}

function addUtcMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + months)
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

/**
 * The true-up window containing `now` within a subscription's current billing period: one of the
 * four quarters of an annual term, or the whole monthly term. Null without a current period.
 */
export function resolveSeatTrueUpWindow(
  sub: { periodStart: Date | null; periodEnd: Date | null; billingInterval: string | null },
  now: Date = new Date()
): SeatTrueUpWindow | null {
  if (!sub.periodStart || !sub.periodEnd) return null
  if (now < sub.periodStart || now >= sub.periodEnd) return null
  if (sub.billingInterval !== 'year') {
    return { start: sub.periodStart, end: sub.periodEnd }
  }
  let offset = 0
  while (
    offset + ANNUAL_TRUE_UP_WINDOW_MONTHS < 12 &&
    addUtcMonths(sub.periodStart, offset + ANNUAL_TRUE_UP_WINDOW_MONTHS) <= now
  ) {
    offset += ANNUAL_TRUE_UP_WINDOW_MONTHS
  }
  const start = addUtcMonths(sub.periodStart, offset)
  const end =
    offset + ANNUAL_TRUE_UP_WINDOW_MONTHS >= 12
      ? sub.periodEnd
      : addUtcMonths(sub.periodStart, offset + ANNUAL_TRUE_UP_WINDOW_MONTHS)
  return { start, end }
}

/**
 * Raises the open window's peak to the members past the contract right now, for one self-serve
 * Enterprise contract. Pending invitations are not seats until accepted. A window keeps the seat
 * rate it opened with, so a rate change applies from the next window.
 */
async function sampleSeatPeak(sub: typeof subscription.$inferSelect, now: Date): Promise<boolean> {
  const window = resolveSeatTrueUpWindow(sub, now)
  const terms = parseEnterpriseSubscriptionMetadata(sub.metadata)
  if (!window || !terms?.seatPriceCents) return false
  const [memberCount] = await db
    .select({ value: count() })
    .from(member)
    .where(eq(member.organizationId, sub.referenceId))
  const extraSeats = Math.max(0, (memberCount?.value ?? 0) - terms.seats)
  await db
    .insert(enterpriseSeatTrueUp)
    .values({
      id: generateId(),
      subscriptionId: sub.id,
      organizationId: sub.referenceId,
      windowStart: window.start,
      windowEnd: window.end,
      peakExtraSeats: extraSeats,
      seatPriceCents: terms.seatPriceCents,
    })
    .onConflictDoUpdate({
      target: [enterpriseSeatTrueUp.subscriptionId, enterpriseSeatTrueUp.windowStart],
      set: {
        peakExtraSeats: sql`GREATEST(${enterpriseSeatTrueUp.peakExtraSeats}, ${extraSeats})`,
        updatedAt: now,
      },
      setWhere: isNull(enterpriseSeatTrueUp.billedAt),
    })
  return true
}

/** Whole months a window spans: what each seat past the contract is billed for. */
function windowMonths(row: { windowStart: Date; windowEnd: Date }): number {
  let months = 0
  while (months < 12 && addUtcMonths(row.windowStart, months + 1) <= row.windowEnd) months++
  return Math.max(1, months)
}

/**
 * Invoices one closed window: its peak seats past the contract, at the seat rate it opened with,
 * for the months it spans. Stamping `billedAt` and enqueuing the invoice commit together under the
 * row lock, so a window is invoiced at most once.
 */
async function billClosedWindow(windowId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        window: enterpriseSeatTrueUp,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      })
      .from(enterpriseSeatTrueUp)
      .innerJoin(subscription, eq(subscription.id, enterpriseSeatTrueUp.subscriptionId))
      .where(and(eq(enterpriseSeatTrueUp.id, windowId), isNull(enterpriseSeatTrueUp.billedAt)))
      .for('update', { of: enterpriseSeatTrueUp })
      .limit(1)
    if (!row) return 0

    const { peakExtraSeats, seatPriceCents } = row.window
    const months = windowMonths(row.window)
    const amountCents = peakExtraSeats * seatPriceCents * months
    const { stripeCustomerId, stripeSubscriptionId } = row
    if (amountCents > 0 && (!stripeCustomerId || !stripeSubscriptionId)) {
      logger.error('Deferring seat true-up: Stripe identifiers are missing', {
        windowId,
        subscriptionId: row.window.subscriptionId,
      })
      return 0
    }

    await tx
      .update(enterpriseSeatTrueUp)
      .set({ amountCents, billedAt: new Date(), updatedAt: new Date() })
      .where(eq(enterpriseSeatTrueUp.id, windowId))

    if (amountCents > 0 && stripeCustomerId && stripeSubscriptionId) {
      const from = row.window.windowStart.toISOString().slice(0, 10)
      const to = row.window.windowEnd.toISOString().slice(0, 10)
      await enqueueOutboxEvent(tx, OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE, {
        customerId: stripeCustomerId,
        stripeSubscriptionId,
        amountCents,
        description: `Seat true-up – ${from} to ${to}`,
        itemDescription: `${peakExtraSeats} additional seat${peakExtraSeats === 1 ? '' : 's'} × ${months} month${months === 1 ? '' : 's'} at $${(seatPriceCents / 100).toFixed(2)} per seat per month`,
        billingPeriod: row.window.windowEnd.toISOString().slice(0, 7),
        invoiceIdemKeyStem: `seat-true-up-invoice:${windowId}`,
        itemIdemKeyStem: `seat-true-up-item:${windowId}`,
        metadata: {
          type: 'enterprise_seat_true_up',
          organizationId: row.window.organizationId,
          subscriptionId: stripeSubscriptionId,
          windowStart: row.window.windowStart.toISOString(),
          windowEnd: row.window.windowEnd.toISOString(),
          extraSeats: String(peakExtraSeats),
        },
      })
    }

    logger.info('Closed Enterprise seat true-up window', {
      windowId,
      organizationId: row.window.organizationId,
      peakExtraSeats,
      amountCents,
    })
    return amountCents
  })
}

/**
 * The seat true-up sweep for self-serve Enterprise contracts: records each open window's peak
 * seats past the contract, then invoices every closed, unbilled window. Seats are billed in
 * arrears, so a customer who removes members pays less from the next window on.
 */
export async function runEnterpriseSeatTrueUps(now: Date = new Date()) {
  const candidates = await db
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.plan, 'enterprise'),
        inArray(subscription.status, ENTITLED_SUBSCRIPTION_STATUSES),
        sql`${subscription.metadata} ->> 'selfServe' = 'true'`
      )
    )
  let sampled = 0
  let failed = 0
  for (const sub of candidates) {
    if (!isEnterpriseSelfServe(sub)) continue
    try {
      if (await sampleSeatPeak(sub, now)) sampled++
    } catch (error) {
      failed++
      logger.error('Failed to sample Enterprise seat true-up peak', {
        subscriptionId: sub.id,
        error,
      })
    }
  }

  const closed = await db
    .select({ id: enterpriseSeatTrueUp.id })
    .from(enterpriseSeatTrueUp)
    .where(and(isNull(enterpriseSeatTrueUp.billedAt), lte(enterpriseSeatTrueUp.windowEnd, now)))
  let billedCents = 0
  for (const window of closed) {
    try {
      billedCents += await billClosedWindow(window.id)
    } catch (error) {
      failed++
      logger.error('Failed to bill Enterprise seat true-up window', { windowId: window.id, error })
    }
  }
  return { sampled, closed: closed.length, failed, billedCents }
}
