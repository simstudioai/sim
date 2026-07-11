/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  subscriptionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
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

vi.mock('@sim/db', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
    transaction: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  member: { userId: 'userId', organizationId: 'organizationId', role: 'role' },
  organization: { id: 'id', name: 'name' },
  outboxEvent: {
    id: 'id',
    eventType: 'eventType',
    payload: 'payload',
    status: 'status',
    createdAt: 'createdAt',
  },
  subscription: {
    id: 'id',
    referenceId: 'referenceId',
    status: 'status',
    stripeSubscriptionId: 'stripeSubscriptionId',
    metadata: 'metadata',
  },
  user: {
    id: 'id',
    name: 'name',
    email: 'email',
    stripeCustomerId: 'stripeCustomerId',
  },
}))

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => 'and'),
  count: vi.fn(() => 'count'),
  desc: vi.fn(() => 'desc'),
  eq: vi.fn(() => 'eq'),
  inArray: vi.fn(() => 'inArray'),
  isNull: vi.fn(() => 'isNull'),
  sql: vi.fn(() => 'sql'),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
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
  decideEnterpriseProvisioningIssue,
  decideEnterpriseProvisioningRetry,
  provisionEnterpriseInStripe,
  syncEnterpriseMetadataInStripe,
} from '@/lib/billing/enterprise-provisioning'

function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    for: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  chain.from.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  chain.leftJoin.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  chain.orderBy.mockReturnValue(chain)
  chain.for.mockReturnValue(chain)
  return chain
}

function operationPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    request: {
      requestKey: 'enterprise-v2:owner-1:org-1:12500:20000:24000:12',
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
      invoiceAmountCents: 12500,
      includedMonthlyCredits: 20000,
      usageLimitCredits: 24000,
      seats: 12,
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
        'enterprise-v2:different-request',
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
  mocks.select
    .mockReturnValueOnce(
      selectChain([
        {
          ownerId: 'owner-1',
          ownerName: 'Owner',
          ownerEmail: 'owner@example.com',
          ownerStripeCustomerId: 'cus_1',
          organizationName: 'Acme',
          ownerRole: 'owner',
        },
      ])
    )
    .mockReturnValueOnce(selectChain([{ value: 1 }]))
    .mockReturnValueOnce(selectChain(localSubscriptions))
    .mockReturnValueOnce(selectChain(finalLocalSubscriptions))
    .mockReturnValueOnce(selectChain([{ value: finalMemberCount }]))
}

describe('Enterprise issuance outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.select.mockReset()
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
          includedMonthlyCredits: '20000',
          usageLimitCredits: '24000',
          seats: '12',
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

    expect(mocks.select).not.toHaveBeenCalled()
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
    mocks.select.mockReset()
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
        includedMonthlyCredits: 30000,
        usageLimitCredits: 35000,
      },
    }
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} }])
      )
      .mockReturnValueOnce(selectChain([{ metadata: {} }]))
      .mockReturnValueOnce(selectChain([{ id: 'metadata-event-1', payload }]))
      .mockReturnValueOnce(selectChain([{ value: 10 }]))
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
          includedMonthlyCredits: '30000',
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

  it('suppresses an older metadata event after acquiring the subscription lease', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 3,
      deliveryRevision: 0,
      metadata: { seats: 12 },
    }
    mocks.select
      .mockReturnValueOnce(
        selectChain([{ stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} }])
      )
      .mockReturnValueOnce(selectChain([{ metadata: {} }]))
      .mockReturnValueOnce(
        selectChain([
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
      )

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
    mocks.select.mockReturnValueOnce(
      selectChain([
        {
          stripeSubscriptionId: 'sub_1',
          referenceId: 'org-1',
          metadata: { simConfigOperationId: 'metadata-event-1' },
        },
      ])
    )

    await syncEnterpriseMetadataInStripe(payload, {
      eventId: 'metadata-event-1',
      eventType: 'stripe.sync-enterprise-metadata',
      attempts: 1,
      checkpointPayload: vi.fn(),
    })

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })
})
