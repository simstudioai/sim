/**
 * Cost callbacks against real PostgreSQL: a direct-v1 run that outlives its admitted Stripe period
 * records its later spend in the payer's current period, so the closed period is never topped up
 * after its invoice. Only the internal-key check is stubbed.
 */
import { db } from '@sim/db'
import { subscription, usageLog, user, userStats } from '@sim/db/schema'
import { envFlagsMock } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
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
import { POST } from '@/app/api/billing/update-cost/route'

const DAY_MS = 24 * 60 * 60 * 1000
const userId = `update-cost-user-${generateId()}`
const subscriptionId = generateId()

afterAll(async () => {
  await db.delete(usageLog).where(eq(usageLog.userId, userId))
  await db.delete(subscription).where(eq(subscription.id, subscriptionId))
  await db.delete(userStats).where(eq(userStats.userId, userId))
  await db.delete(user).where(eq(user.id, userId))
})

function callback(requestKey: string, cost: number, decision: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/billing/update-cost', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'internal',
      'x-sim-billing-protocol': 'direct-v1',
      'x-sim-billing-request-id': requestKey,
      [BILLING_ACCOUNT_DECISION_HEADER]: decision,
    },
    body: JSON.stringify({
      userId,
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
    await db.insert(user).values({
      id: userId,
      name: 'Update Cost Test',
      email: `${userId}@update-cost.test`,
      emailVerified: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    await db.insert(userStats).values({ id: generateId(), userId })
    await db.insert(subscription).values({
      id: subscriptionId,
      plan: 'pro',
      referenceId: userId,
      status: 'active',
      periodStart: admitted.start,
      periodEnd: admitted.end,
    })
    const decision = serializeAccountBillingDecisionHeader({
      userId,
      billingEntity: { type: 'user', id: userId },
      billingPeriod: {
        start: admitted.start.toISOString(),
        end: admitted.end.toISOString(),
        source: 'stripe',
      },
      payerSubscriptionId: subscriptionId,
    })
    const requestKey = generateId()

    expect((await POST(callback(requestKey, 0.5, decision), {})).status).toBe(200)
    await db
      .update(subscription)
      .set({ periodStart: rolled.start, periodEnd: rolled.end })
      .where(eq(subscription.id, subscriptionId))
    expect((await POST(callback(requestKey, 0.8, decision), {})).status).toBe(200)

    const rows = await db
      .select({
        eventKey: usageLog.eventKey,
        cost: usageLog.cost,
        billingPeriodStart: usageLog.billingPeriodStart,
      })
      .from(usageLog)
      .where(eq(usageLog.userId, userId))
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
})
