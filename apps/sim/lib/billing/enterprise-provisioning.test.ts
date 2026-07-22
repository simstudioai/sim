/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  subscriptionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  invoicesRetrieve: vi.fn(),
  invoicesUpdate: vi.fn(),
  customersCreate: vi.fn(),
  customersList: vi.fn(),
  productsCreate: vi.fn(),
  productsRetrieve: vi.fn(),
  pricesList: vi.fn(),
  pricesRetrieve: vi.fn(),
  enqueue: vi.fn(),
  patchPayload: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { ENTERPRISE_SUBSCRIPTION_PROVISIONED: 'subscription.enterprise_provisioned' },
  AuditResourceType: { SUBSCRIPTION: 'subscription' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: vi.fn(),
}))
vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({
    customers: { create: mocks.customersCreate, list: mocks.customersList },
    products: { create: mocks.productsCreate, retrieve: mocks.productsRetrieve },
    prices: { list: mocks.pricesList, retrieve: mocks.pricesRetrieve },
    subscriptions: {
      create: mocks.subscriptionsCreate,
      list: mocks.subscriptionsList,
      update: mocks.subscriptionsUpdate,
    },
    invoices: { retrieve: mocks.invoicesRetrieve, update: mocks.invoicesUpdate },
  }),
}))
vi.mock('@/lib/billing/webhooks/enterprise-reconciliation-lease', () => ({
  withEnterpriseReconciliationLease: vi.fn(async (_id: string, operation: () => Promise<unknown>) =>
    operation()
  ),
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mocks.enqueue,
  patchOutboxEventPayload: mocks.patchPayload,
}))

import {
  buildEnterpriseProvisioningRequestKey,
  decideEnterpriseProvisioningIssue,
  decideEnterpriseProvisioningRetry,
  provisionEnterpriseInStripe,
  syncEnterpriseMetadataInStripe,
} from '@/lib/billing/enterprise-provisioning'

afterAll(() => {
  resetDbChainMock()
})

function operationPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    request: {
      requestKey: 'enterprise-v3:owner-1:org-1:12500:24000:12:1250',
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
      invoiceAmountCents: 12500,
      usageLimitCredits: 24000,
      seats: 12,
      concurrencyLimit: 1250,
      pausePaymentCollection: false,
    },
    retryRevision: 0,
    stripeProgress: {},
    ...overrides,
  }
}

function context() {
  return {
    eventId: 'operation-1',
    eventType: 'stripe.provision-enterprise',
    attempts: 0,
    checkpointPayload: vi.fn().mockResolvedValue(undefined),
  }
}

describe('Enterprise issuance serialization decisions', () => {
  it('includes the configured or invoice-defaulted usage limit in the request key', () => {
    const input = {
      ownerUserId: 'owner-1',
      monthlyInvoiceAmountUsd: 125,
      usageLimitCredits: 24000,
      seats: 12,
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
    }

    expect(buildEnterpriseProvisioningRequestKey(input, 'org-1')).toBe(
      'enterprise-v3:owner-1:org-1:12500:24000:12'
    )
    expect(
      buildEnterpriseProvisioningRequestKey({ ...input, concurrencyLimit: 1250 }, 'org-1')
    ).toBe('enterprise-v3:owner-1:org-1:12500:24000:12:1250')
    expect(
      buildEnterpriseProvisioningRequestKey({ ...input, pausePaymentCollection: true }, 'org-1')
    ).toBe('enterprise-v3:owner-1:org-1:12500:24000:12:draft-collection')
    expect(
      buildEnterpriseProvisioningRequestKey({ ...input, usageLimitCredits: undefined }, 'org-1')
    ).toBe('enterprise-v3:owner-1:org-1:12500:25000:12')
  })

  it('deduplicates an identical unresolved request to the existing outbox operation', () => {
    expect(
      decideEnterpriseProvisioningIssue(
        operationPayload().request.requestKey,
        [{ id: 'operation-1', payload: operationPayload() }],
        []
      )
    ).toEqual({ kind: 'reuse', operationId: 'operation-1' })
  })

  it('rejects a different request while the existing operation is unresolved', () => {
    expect(() =>
      decideEnterpriseProvisioningIssue(
        'enterprise-v3:different-request',
        [{ id: 'operation-1', payload: operationPayload() }],
        []
      )
    ).toThrow('unfinished Enterprise issuance')
  })

  it('keeps an applied active request deduplicated to its original operation', () => {
    const applied = operationPayload({
      applicationResult: {
        appliedAt: '2026-07-09T12:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    expect(
      decideEnterpriseProvisioningIssue(
        applied.request.requestKey,
        [{ id: 'operation-1', payload: applied }],
        [{ status: 'active', stripeSubscriptionId: 'sub-1', metadata: {} }]
      )
    ).toEqual({ kind: 'reuse', operationId: 'operation-1' })
  })

  it.each([
    ['dead_letter', 'dead_letter'],
    ['awaiting_webhook', 'completed'],
  ] as const)('retries %s on the same row with a monotonic revision', (_name, status) => {
    expect(decideEnterpriseProvisioningRetry('operation-1', status, operationPayload())).toEqual({
      shouldRetry: true,
      operationId: 'operation-1',
      retryRevision: 1,
    })
  })

  it.each(['pending', 'processing'] as const)('does not retry %s operations', (status) => {
    expect(decideEnterpriseProvisioningRetry('operation-1', status, operationPayload())).toEqual({
      shouldRetry: false,
      operationId: 'operation-1',
    })
  })

  it('does not retry an operation already applied by its webhook', () => {
    const applied = operationPayload({
      applicationResult: {
        appliedAt: '2026-07-09T12:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    expect(decideEnterpriseProvisioningRetry('operation-1', 'dead_letter', applied)).toEqual({
      shouldRetry: false,
      operationId: 'operation-1',
    })
  })
})

function arrangeWorkerReads(
  localSubscriptions: unknown[] = [],
  finalLocalSubscriptions: unknown[] = localSubscriptions,
  finalMemberCount = 1
) {
  queueTableRows(schemaMock.user, [
    {
      ownerId: 'owner-1',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      ownerStripeCustomerId: 'cus_1',
      organizationName: 'Acme',
      ownerRole: 'owner',
    },
  ])
  queueTableRows(schemaMock.member, [{ value: 1 }])
  queueTableRows(schemaMock.subscription, localSubscriptions)
  queueTableRows(schemaMock.subscription, finalLocalSubscriptions)
  queueTableRows(schemaMock.member, [{ value: finalMemberCount }])
}

describe('Enterprise issuance outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false })
    mocks.customersList.mockResolvedValue({ data: [], has_more: false })
    mocks.pricesList.mockResolvedValue({ data: [], has_more: false })
    mocks.productsRetrieve.mockRejectedValue({ code: 'resource_missing' })
    mocks.productsCreate.mockResolvedValue({ id: 'prod_1', default_price: 'price_1' })
    mocks.pricesRetrieve.mockResolvedValue({
      id: 'price_1',
      currency: 'usd',
      unit_amount: 12500,
      recurring: { interval: 'month' },
      product: 'prod_1',
      metadata: { enterpriseOperationId: 'operation-1' },
    })
    mocks.subscriptionsCreate.mockResolvedValue({ id: 'sub_1' })
    mocks.invoicesRetrieve.mockResolvedValue({ id: 'in_1', status: 'draft', auto_advance: true })
    mocks.invoicesUpdate.mockResolvedValue({ id: 'in_1', status: 'draft', auto_advance: false })
  })

  it('creates one monthly send-invoice subscription and checkpoints progress', async () => {
    arrangeWorkerReads()
    const handlerContext = context()

    await provisionEnterpriseInStripe(operationPayload(), handlerContext)

    expect(mocks.productsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^prod_sim_enterprise_/),
        default_price_data: expect.objectContaining({
          currency: 'usd',
          unit_amount: 12500,
          recurring: { interval: 'month' },
        }),
      }),
      { idempotencyKey: 'enterprise:operation-1:product' }
    )
    expect(mocks.subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        items: [{ price: 'price_1', quantity: 1 }],
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata: expect.objectContaining({
          enterpriseOperationId: 'operation-1',
          referenceId: 'org-1',
          usageLimitCredits: '24000',
          seats: '12',
          concurrencyLimit: '1250',
        }),
      }),
      { idempotencyKey: 'enterprise:operation-1:subscription' }
    )
    expect(handlerContext.checkpointPayload).toHaveBeenLastCalledWith({
      stripeProgress: {
        customerId: 'cus_1',
        productId: 'prod_1',
        priceId: 'price_1',
        subscriptionId: 'sub_1',
      },
    })
  })

  it('recovers an existing subscription and nudges a genuine webhook with retry revision', async () => {
    arrangeWorkerReads()
    mocks.subscriptionsList.mockResolvedValue({
      data: [
        {
          id: 'sub_existing',
          status: 'active',
          metadata: { enterpriseOperationId: 'operation-1', referenceId: 'org-1' },
        },
      ],
      has_more: false,
    })
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_existing' })

    await provisionEnterpriseInStripe(
      operationPayload({ retryRevision: 3, stripeProgress: { customerId: 'cus_1' } }),
      context()
    )

    expect(mocks.productsCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_existing',
      expect.objectContaining({
        metadata: expect.objectContaining({ enterpriseRetryRevision: '3' }),
      }),
      { idempotencyKey: 'enterprise:operation-1:retry:3' }
    )
  })

  it('freezes the initial invoice and pauses collection indefinitely when requested', async () => {
    arrangeWorkerReads()
    mocks.subscriptionsCreate.mockResolvedValue({ id: 'sub_1', latest_invoice: 'in_1' })
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' })
    const pausedPayload = operationPayload({
      request: {
        ...operationPayload().request,
        requestKey: 'enterprise-v3:owner-1:org-1:12500:24000:12:1250:draft-collection',
        pausePaymentCollection: true,
      },
    })

    await provisionEnterpriseInStripe(pausedPayload, context())

    expect(mocks.invoicesUpdate).toHaveBeenCalledWith(
      'in_1',
      { auto_advance: false },
      { idempotencyKey: 'enterprise:operation-1:initial-invoice-draft' }
    )
    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        pause_collection: { behavior: 'keep_as_draft' },
      }),
      { idempotencyKey: 'enterprise:operation-1:pause-collection' }
    )
  })

  it('fails closed instead of claiming a paused demo when its initial invoice finalized', async () => {
    arrangeWorkerReads()
    mocks.subscriptionsCreate.mockResolvedValue({ id: 'sub_1', latest_invoice: 'in_1' })
    mocks.invoicesRetrieve.mockResolvedValue({ id: 'in_1', status: 'open', auto_advance: true })
    const pausedPayload = operationPayload({
      request: {
        ...operationPayload().request,
        requestKey: 'enterprise-v3:owner-1:org-1:12500:24000:12:1250:draft-collection',
        pausePaymentCollection: true,
      },
    })

    await expect(provisionEnterpriseInStripe(pausedPayload, context())).rejects.toThrow(
      'initial invoice in_1 is already open'
    )
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('rejects a different live Stripe subscription before create', async () => {
    arrangeWorkerReads()
    mocks.subscriptionsList.mockResolvedValue({
      data: [
        {
          id: 'sub_other',
          status: 'active',
          metadata: { enterpriseOperationId: 'other', referenceId: 'org-1' },
        },
      ],
      has_more: false,
    })

    await expect(provisionEnterpriseInStripe(operationPayload(), context())).rejects.toThrow(
      'different nonterminal Stripe subscription'
    )
    expect(mocks.productsCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('rechecks local entitlement state immediately before Stripe create', async () => {
    arrangeWorkerReads([], [{ status: 'active', stripeSubscriptionId: 'sub_team', metadata: {} }])

    await expect(provisionEnterpriseInStripe(operationPayload(), context())).rejects.toThrow(
      'different nonterminal subscription'
    )

    expect(mocks.productsCreate).toHaveBeenCalled()
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('rechecks fixed-seat capacity immediately before Stripe create', async () => {
    arrangeWorkerReads([], [], 13)

    await expect(provisionEnterpriseInStripe(operationPayload(), context())).rejects.toThrow(
      'seat capacity is below current internal membership'
    )

    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('is harmless when the webhook already marked the operation applied', async () => {
    await provisionEnterpriseInStripe(
      operationPayload({
        applicationResult: {
          appliedAt: '2026-07-09T12:00:00.000Z',
          subscriptionId: 'sub_1',
        },
      }),
      context()
    )

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('fails closed on an invalid operation payload', async () => {
    await expect(provisionEnterpriseInStripe({ version: 1 }, context())).rejects.toThrow(
      'Invalid Enterprise issuance outbox payload'
    )
  })
})

describe('Enterprise metadata outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('pushes only the latest full desired metadata under an operation-stable key', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 4,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        usageLimitCredits: 35000,
        concurrencyLimit: 1250,
      },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-1', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-1',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).rejects.toThrow('Awaiting verified Stripe webhook application')

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_1',
      {
        metadata: expect.objectContaining({
          seats: '15',
          concurrencyLimit: '1250',
          simConfigRevision: '4',
          simConfigOperationId: 'metadata-event-1',
          simConfigDeliveryRevision: '0',
          simConfigDeliveryAttempt: '0',
        }),
      },
      {
        idempotencyKey: 'enterprise-config:local-sub-1:metadata-event-1:delivery:0:attempt:0',
      }
    )
  })

  it('unsets nullable metadata overrides in Stripe', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 5,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        concurrencyLimit: null,
      },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-2', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_1' })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-2',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).rejects.toThrow('Awaiting verified Stripe webhook application')

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_1',
      {
        metadata: expect.objectContaining({
          concurrencyLimit: '',
          simConfigOperationId: 'metadata-event-2',
        }),
      },
      expect.any(Object)
    )
  })

  it('suppresses an older metadata event after acquiring the subscription lease', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 3,
      deliveryRevision: 0,
      metadata: { seats: 12 },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [
      {
        id: 'newer-event',
        payload: {
          subscriptionId: 'local-sub-1',
          revision: 4,
          deliveryRevision: 0,
          metadata: { seats: 15 },
        },
      },
    ])

    await syncEnterpriseMetadataInStripe(payload, {
      eventId: 'older-event',
      eventType: 'stripe.sync-enterprise-metadata',
      attempts: 0,
      checkpointPayload: vi.fn(),
    })

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('completes after the verified webhook applies the operation marker', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 4,
      deliveryRevision: 0,
      metadata: { seats: 15 },
    }
    queueTableRows(schemaMock.subscription, [
      {
        stripeSubscriptionId: 'sub_1',
        referenceId: 'org-1',
        metadata: { simConfigOperationId: 'metadata-event-1' },
      },
    ])

    await syncEnterpriseMetadataInStripe(payload, {
      eventId: 'metadata-event-1',
      eventType: 'stripe.sync-enterprise-metadata',
      attempts: 1,
      checkpointPayload: vi.fn(),
    })

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })
})
