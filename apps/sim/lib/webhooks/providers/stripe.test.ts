import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { stripeHandler } from '@/lib/webhooks/providers/stripe'

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/test', { headers })
}

const WEBHOOK_SECRET = 'whsec_test_secret'

function signedRequest(rawBody: string, secret = WEBHOOK_SECRET) {
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret,
  })
  return reqWithHeaders({ 'stripe-signature': header })
}

describe('Stripe webhook provider', () => {
  it('verifyAuth rejects when webhookSecret is not configured', async () => {
    const res = await stripeHandler.verifyAuth!({
      request: reqWithHeaders({}),
      rawBody: '{}',
      requestId: 't1',
      providerConfig: {},
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth rejects an invalid signature', async () => {
    const rawBody = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.created' })
    const res = await stripeHandler.verifyAuth!({
      request: reqWithHeaders({ 'stripe-signature': 't=1,v1=bad' }),
      rawBody,
      requestId: 't3',
      providerConfig: { webhookSecret: WEBHOOK_SECRET },
      webhook: {},
      workflow: {},
    })
    expect(res?.status).toBe(401)
  })

  it('verifyAuth accepts a validly signed payload', async () => {
    const rawBody = JSON.stringify({ id: 'evt_1', object: 'event', type: 'customer.created' })
    const res = await stripeHandler.verifyAuth!({
      request: signedRequest(rawBody),
      rawBody,
      requestId: 't4',
      providerConfig: { webhookSecret: WEBHOOK_SECRET },
      webhook: {},
      workflow: {},
    })
    expect(res).toBeNull()
  })

  it('shouldSkipEvent filters events outside the configured eventTypes allowlist', () => {
    const skip = stripeHandler.shouldSkipEvent!({
      webhook: { id: 'w1' },
      body: { type: 'invoice.paid' },
      requestId: 't6',
      providerConfig: { eventTypes: ['customer.created'] },
    })
    expect(skip).toBe(true)
  })

  it('extractIdempotencyId returns the Stripe event id for event objects', () => {
    const id = stripeHandler.extractIdempotencyId!({ id: 'evt_123', object: 'event' })
    expect(id).toBe('evt_123')
  })
})
