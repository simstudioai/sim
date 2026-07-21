/**
 * @vitest-environment node
 */

import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/schema', () => ({
  outboxEvent: {
    id: 'id',
    eventType: 'eventType',
    payload: 'payload',
    status: 'status',
    createdAt: 'createdAt',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  desc: vi.fn(() => 'desc'),
  eq: vi.fn(() => 'eq'),
  sql: vi.fn(() => 'sql'),
}))

import {
  assertNoCompetingEnterpriseIssuance,
  assertNoUnresolvedEnterpriseIssuance,
  deriveEnterpriseOperationStatus,
  EnterpriseIssuanceInProgressError,
  enterpriseOperationMatchesStripeSubscription,
  enterpriseProvisionPayloadSchema,
  isEnterpriseOperationUnresolved,
  resolveEnterpriseMetadataIntent,
} from '@/lib/billing/enterprise-outbox'

const payload = {
  version: 1 as const,
  request: {
    requestKey: 'enterprise-v3:owner-1:org-1:10000:20000:5:1250',
    ownerUserId: 'owner-1',
    organizationId: 'org-1',
    requestedByEmail: 'admin@sim.ai',
    requestedByUserId: 'admin-1',
    invoiceAmountCents: 10000,
    usageLimitCredits: 20000,
    seats: 5,
    concurrencyLimit: 1250,
    pausePaymentCollection: false,
  },
  retryRevision: 0,
  stripeProgress: {},
}

function stripeSubscription(
  options: {
    itemCount?: number
    quantity?: number
    currency?: string
    amount?: number
    interval?: string
    intervalCount?: number
    collectionMethod?: string
    daysUntilDue?: number
    metadata?: Record<string, string>
    pauseCollection?: { behavior: 'keep_as_draft'; resumes_at: number | null } | null
  } = {}
): Stripe.Subscription {
  const price = {
    currency: options.currency ?? 'usd',
    unit_amount: options.amount ?? 10000,
    recurring: {
      interval: options.interval ?? 'month',
      interval_count: options.intervalCount ?? 1,
    },
  }
  const item = { quantity: options.quantity ?? 1, price }
  return {
    collection_method: options.collectionMethod ?? 'send_invoice',
    days_until_due: options.daysUntilDue ?? 30,
    pause_collection: options.pauseCollection ?? null,
    items: { data: Array.from({ length: options.itemCount ?? 1 }, () => item) },
    metadata: {
      invoiceAmountCents: '10000',
      usageLimitCredits: '20000',
      seats: '5',
      concurrencyLimit: '1250',
      ...options.metadata,
    },
  } as unknown as Stripe.Subscription
}

describe('Enterprise outbox operation state', () => {
  it('maps the generic outbox lifecycle to the admin issuance lifecycle', () => {
    expect(deriveEnterpriseOperationStatus('pending', payload)).toBe('pending')
    expect(deriveEnterpriseOperationStatus('processing', payload)).toBe('processing')
    expect(deriveEnterpriseOperationStatus('dead_letter', payload)).toBe('dead_letter')
    expect(deriveEnterpriseOperationStatus('completed', payload)).toBe('awaiting_webhook')
  })

  it('treats the transactional webhook marker as dominant over worker status', () => {
    const applied = {
      ...payload,
      applicationResult: {
        appliedAt: '2026-07-09T12:00:00.000Z',
        subscriptionId: 'sub_1',
      },
    }
    expect(deriveEnterpriseOperationStatus('processing', applied)).toBe('applied')
    expect(isEnterpriseOperationUnresolved('dead_letter', applied)).toBe(false)
  })

  it('rejects zero-cent invoices and malformed checkpoint state', () => {
    expect(
      enterpriseProvisionPayloadSchema.safeParse({
        ...payload,
        request: { ...payload.request, invoiceAmountCents: 0 },
      }).success
    ).toBe(false)
    expect(
      enterpriseProvisionPayloadSchema.safeParse({
        ...payload,
        stripeProgress: { subscriptionId: '' },
      }).success
    ).toBe(false)
  })

  it('keeps pre-concurrency Enterprise outbox payloads valid', () => {
    const {
      concurrencyLimit: _concurrencyLimit,
      pausePaymentCollection: _pausePaymentCollection,
      ...legacyRequest
    } = payload.request
    const parsed = enterpriseProvisionPayloadSchema.safeParse({
      ...payload,
      request: legacyRequest,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.request.pausePaymentCollection).toBe(false)
  })
})

describe('Enterprise issuance Stripe-term correlation', () => {
  it('accepts only the exact requested invoice shape and metadata', () => {
    expect(
      enterpriseOperationMatchesStripeSubscription(payload, stripeSubscription(), 'org-1')
    ).toBe(true)
  })

  it('accepts an indefinitely draft-paused subscription only when requested', () => {
    const pausedPayload = {
      ...payload,
      request: {
        ...payload.request,
        requestKey: 'enterprise-v3:owner-1:org-1:10000:20000:5:1250:draft-collection',
        pausePaymentCollection: true,
      },
    }
    const pausedSubscription = stripeSubscription({
      pauseCollection: { behavior: 'keep_as_draft', resumes_at: null },
    })

    expect(
      enterpriseOperationMatchesStripeSubscription(pausedPayload, pausedSubscription, 'org-1')
    ).toBe(true)
    expect(
      enterpriseOperationMatchesStripeSubscription(pausedPayload, stripeSubscription(), 'org-1')
    ).toBe(false)
    expect(enterpriseOperationMatchesStripeSubscription(payload, pausedSubscription, 'org-1')).toBe(
      false
    )
  })

  it.each([
    ['two items', { itemCount: 2 }],
    ['quantity two', { quantity: 2 }],
    ['wrong currency', { currency: 'eur' }],
    ['wrong amount', { amount: 20000 }],
    ['wrong interval', { interval: 'year' }],
    ['wrong interval count', { intervalCount: 2 }],
    ['automatic collection', { collectionMethod: 'charge_automatically' }],
    ['wrong due terms', { daysUntilDue: 14 }],
    ['wrong usage limit', { metadata: { usageLimitCredits: '999' } }],
    ['wrong seats', { metadata: { seats: '6' } }],
    ['wrong concurrency', { metadata: { concurrencyLimit: '999' } }],
  ] as const)('rejects %s', (_name, options) => {
    expect(
      enterpriseOperationMatchesStripeSubscription(payload, stripeSubscription(options), 'org-1')
    ).toBe(false)
  })
})

function executorReturning(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  }
  return { select: () => chain } as never
}

describe('Enterprise metadata intent admission state', () => {
  it('uses the lower of applied and unapplied desired seats', async () => {
    const state = await resolveEnterpriseMetadataIntent(
      executorReturning([
        {
          id: 'config-2',
          status: 'pending',
          payload: {
            subscriptionId: 'sub-local',
            revision: 2,
            metadata: { seats: 7 },
          },
        },
      ]),
      'sub-local',
      { seats: '10', simConfigRevision: '1', simConfigOperationId: 'config-1' }
    )

    expect(state.hasUnappliedIntent).toBe(true)
    expect(state.effectiveSeatCapacity).toBe(7)
    expect(state.configurationUpdate).toEqual({
      id: 'config-2',
      status: 'pending',
      requestedMetadata: { seats: 7 },
      error: null,
    })
  })

  it('falls back to applied seats for a dead-lettered intent', async () => {
    const state = await resolveEnterpriseMetadataIntent(
      executorReturning([
        {
          id: 'config-2',
          status: 'dead_letter',
          payload: {
            subscriptionId: 'sub-local',
            revision: 2,
            metadata: { seats: 7 },
          },
        },
      ]),
      'sub-local',
      { seats: '10', simConfigRevision: '1', simConfigOperationId: 'config-1' }
    )

    expect(state.hasUnappliedIntent).toBe(false)
    expect(state.effectiveSeatCapacity).toBe(10)
    expect(state.configurationUpdate).toEqual({
      id: 'config-2',
      status: 'failed',
      requestedMetadata: { seats: 7 },
      error: null,
    })
  })

  it('hides the update after the verified webhook applies its operation id', async () => {
    const state = await resolveEnterpriseMetadataIntent(
      executorReturning([
        {
          id: 'config-2',
          status: 'pending',
          payload: {
            subscriptionId: 'sub-local',
            revision: 2,
            metadata: { seats: 7 },
          },
        },
      ]),
      'sub-local',
      { seats: '7', simConfigRevision: '2', simConfigOperationId: 'config-2' }
    )

    expect(state.hasUnappliedIntent).toBe(false)
    expect(state.configurationUpdate).toBeNull()
  })

  it('fails closed when the newest desired metadata payload is malformed', async () => {
    await expect(
      resolveEnterpriseMetadataIntent(
        executorReturning([{ id: 'config-bad', status: 'pending', payload: { revision: 3 } }]),
        'sub-local',
        { seats: '10' }
      )
    ).rejects.toThrow('config-bad is invalid')
  })
})

describe('Enterprise issuance reservation guard', () => {
  it('blocks competing entitlement mutations until webhook application is recorded', async () => {
    await expect(
      assertNoUnresolvedEnterpriseIssuance(
        executorReturning([{ id: 'operation-1', status: 'completed', payload }]),
        'org-1'
      )
    ).rejects.toBeInstanceOf(EnterpriseIssuanceInProgressError)
  })

  it('releases the reservation after transactional webhook application', async () => {
    await expect(
      assertNoUnresolvedEnterpriseIssuance(
        executorReturning([
          {
            id: 'operation-1',
            status: 'completed',
            payload: {
              ...payload,
              applicationResult: {
                appliedAt: '2026-07-09T12:00:00.000Z',
                subscriptionId: 'sub-1',
              },
            },
          },
        ]),
        'org-1'
      )
    ).resolves.toBeUndefined()
  })

  it('allows only the correlated Stripe callback for the same unresolved operation', async () => {
    const executor = executorReturning([{ id: 'operation-1', status: 'completed', payload }])
    await expect(
      assertNoCompetingEnterpriseIssuance(executor, 'org-1', 'operation-1')
    ).resolves.toBeUndefined()

    await expect(
      assertNoCompetingEnterpriseIssuance(
        executorReturning([{ id: 'operation-1', status: 'completed', payload }]),
        'org-1',
        'different-operation'
      )
    ).rejects.toBeInstanceOf(EnterpriseIssuanceInProgressError)
  })
})
