/**
 * Cost callbacks against real PostgreSQL: a direct-v1 run that outlives its admitted Stripe period
 * records its later spend in the payer's current period, so the closed period is never topped up
 * after its invoice, and spend after the payer's terminal settlement is refused. Only the
 * internal-key check is stubbed.
 */
import { db } from '@sim/db'
import { subscription, usageLog, user, userStats } from '@sim/db/schema'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env-flags', () => ({
  ...envFlagsMock,
  isHosted: true,
  isBillingEnabled: true,
}))
vi.mock('@/lib/mothership/request/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mothership/request/http')>()),
  checkInternalApiKey: () => ({ success: true }),
}))

import {
  BILLING_ACCOUNT_DECISION_HEADER,
  serializeAccountBillingDecisionHeader,
} from '@/lib/billing/core/billing-attribution'
import { claimTerminalPeriod } from '@/lib/billing/cycle-close'
import { POST } from '@/app/api/billing/update-cost/route'

const DAY_MS = 24 * 60 * 60 * 1000
const userIds: string[] = []

afterAll(async () => {
  if (userIds.length === 0) return
  await db.delete(usageLog).where(inArray(usageLog.userId, userIds))
  await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
  await db.delete(userStats).where(inArray(userStats.userId, userIds))
  await db.delete(user).where(inArray(user.id, userIds))
})

interface Payer {
  userId: string
  subscriptionId: string
  /** The direct-v1 decision of a run admitted in the subscription's period. */
  decision: string
}

/** A user on a pro subscription for `period`, whose close marker has caught up to it. */
async function createPayer(period: { start: Date; end: Date }): Promise<Payer> {
  const userId = `update-cost-user-${generateId()}`
  const subscriptionId = generateId()
  userIds.push(userId)
  await db.insert(user).values({
    id: userId,
    name: 'Update Cost Test',
    email: `${userId}@update-cost.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(userStats).values({ id: generateId(), userId })
  await db.insert(subscription).values({
    id: subscriptionId,
    plan: 'pro',
    referenceId: userId,
    status: 'active',
    periodStart: period.start,
    periodEnd: period.end,
    lastClosedPeriodStart: period.start,
  })
  const decision = serializeAccountBillingDecisionHeader({
    userId,
    billingEntity: { type: 'user', id: userId },
    billingPeriod: {
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      source: 'stripe',
    },
    payerSubscriptionId: subscriptionId,
  })
  return { userId, subscriptionId, decision }
}

function requestRows(requestKey: string) {
  return db
    .select({
      eventKey: usageLog.eventKey,
      cost: usageLog.cost,
      billingPeriodStart: usageLog.billingPeriodStart,
    })
    .from(usageLog)
    .where(inArray(usageLog.eventKey, [`update-cost:${requestKey}`, `update-cost:${requestKey}@1`]))
}

function callback(payer: Payer, requestKey: string, cost: number): NextRequest {
  return new NextRequest('http://localhost:3000/api/billing/update-cost', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'internal',
      'x-sim-billing-protocol': 'direct-v1',
      'x-sim-billing-request-id': requestKey,
      [BILLING_ACCOUNT_DECISION_HEADER]: payer.decision,
    },
    body: JSON.stringify({
      userId: payer.userId,
      cost,
      model: 'test-model',
      source: 'copilot',
      idempotencyKey: requestKey,
    }),
  })
}

describe('direct-v1 cost callbacks in PostgreSQL', () => {
  it('records spend after a Stripe rollover in the payer current period', async () => {
    const now = Date.now()
    const admitted = { start: new Date(now - 10 * DAY_MS), end: new Date(now + 20 * DAY_MS) }
    const rolled = { start: new Date(now - 60 * 60 * 1000), end: new Date(now + 30 * DAY_MS) }
    const payer = await createPayer(admitted)
    const requestKey = generateId()

    expect((await POST(callback(payer, requestKey, 0.5), {})).status).toBe(200)
    await db
      .update(subscription)
      .set({ periodStart: rolled.start, periodEnd: rolled.end })
      .where(eq(subscription.id, payer.subscriptionId))
    expect((await POST(callback(payer, requestKey, 0.8), {})).status).toBe(200)

    const rows = await requestRows(requestKey)
    const byKey = new Map(rows.map((row) => [row.eventKey, row]))
    expect(rows).toHaveLength(2)
    expect(Number(byKey.get(`update-cost:${requestKey}`)?.cost)).toBeCloseTo(0.5)
    expect(byKey.get(`update-cost:${requestKey}`)?.billingPeriodStart?.getTime()).toBe(
      admitted.start.getTime()
    )
    expect(Number(byKey.get(`update-cost:${requestKey}@1`)?.cost)).toBeCloseTo(0.3)
    expect(byKey.get(`update-cost:${requestKey}@1`)?.billingPeriodStart?.getTime()).toBe(
      rolled.start.getTime()
    )
  })

  it("refuses spend that lands after the payer's terminal settlement", async () => {
    const now = Date.now()
    const period = { start: new Date(now - 10 * DAY_MS), end: new Date(now + 20 * DAY_MS) }
    const payer = await createPayer(period)
    const requestKey = generateId()

    expect((await POST(callback(payer, requestKey, 0.5), {})).status).toBe(200)
    await claimTerminalPeriod(payer.subscriptionId)
    const late = await POST(callback(payer, requestKey, 0.8), {})

    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({ code: 'BILLING_PERIOD_ELAPSED', retryable: false })
    expect((await requestRows(requestKey)).map((row) => Number(row.cost))).toEqual([0.5])
  })
})
