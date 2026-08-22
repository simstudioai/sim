/**
 * @vitest-environment node
 */
import {
  createMockStripeEvent,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  patchOutboxEventPayload: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  enqueueOutboxEvents: vi.fn(),
  getEnterpriseIssuanceSeatRequirement: vi.fn(),
  reapplyPaidOrgJoinBillingForExistingMemberTx: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { ENTERPRISE_SUBSCRIPTION_PROVISIONED: 'subscription.enterprise_provisioned' },
  AuditResourceType: { SUBSCRIPTION: 'subscription' },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))

vi.mock('@/components/emails', () => ({
  getEmailSubject: vi.fn(() => 'Enterprise subscription'),
  renderEnterpriseSubscriptionEmail: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
  reapplyPaidOrgJoinBillingForExistingMemberTx: mocks.reapplyPaidOrgJoinBillingForExistingMemberTx,
}))

vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  getEnterpriseIssuanceSeatRequirement: mocks.getEnterpriseIssuanceSeatRequirement,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({
    subscriptions: { retrieve: mocks.subscriptionsRetrieve },
  }),
}))

vi.mock('@/lib/billing/webhooks/enterprise-reconciliation-lease', () => ({
  assertEnterpriseReconciliationLeaseHeld: vi.fn(),
  withEnterpriseReconciliationLease: vi.fn(
    async (
      _subscriptionId: string,
      operation: (lease: { key: string; token: string }) => Promise<unknown>
    ) => operation({ key: 'test-lease', token: 'test-token' })
  ),
}))

vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mocks.enqueueOutboxEvent,
  enqueueOutboxEvents: mocks.enqueueOutboxEvents,
  patchOutboxEventPayload: mocks.patchOutboxEventPayload,
}))

vi.mock('@/lib/messaging/email/mailer', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn(() => 'billing@sim.test'),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'

const ENTERPRISE_PROVISION_EVENT_TYPE = 'stripe.provision-enterprise'

function operationPayload(
  options: {
    applied?: boolean
    pausePaymentCollection?: boolean
    workspaceIds?: string[]
    invitations?: Array<{
      email: string
      role: 'admin' | 'member'
      permission: 'admin' | 'write' | 'read'
    }>
    logoutOwnerOnApply?: boolean
  } = {}
) {
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
      workspaceIds: options.workspaceIds ?? [],
      invitations: options.invitations ?? [],
      logoutOwnerOnApply: options.logoutOwnerOnApply ?? false,
      pausePaymentCollection: options.pausePaymentCollection ?? false,
    },
    retryRevision: 0,
    stripeProgress: { subscriptionId: 'sub_1' },
    ...(options.applied
      ? {
          applicationResult: {
            appliedAt: '2026-07-30T12:00:00.000Z',
            subscriptionId: 'sub_1',
          },
        }
      : {}),
  }
}

function stripeSubscription(options: {
  operationId?: string
  paused?: boolean
  configOperationId?: string
  seats?: number
  status?: Stripe.Subscription.Status
}): Stripe.Subscription {
  const seats = options.seats ?? 12
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: options.status ?? 'active',
    collection_method: 'send_invoice',
    days_until_due: 30,
    pause_collection: options.paused ? { behavior: 'keep_as_draft', resumes_at: null } : null,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    trial_start: null,
    trial_end: null,
    metadata: {
      plan: 'enterprise',
      referenceId: 'org-1',
      organizationId: 'org-1',
      invoiceAmountCents: '12500',
      monthlyPrice: '125.00',
      usageLimitCredits: '24000',
      seats: String(seats),
      concurrencyLimit: '1250',
      ...(options.operationId ? { enterpriseOperationId: options.operationId } : {}),
      ...(options.configOperationId ? { simConfigOperationId: options.configOperationId } : {}),
    },
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: 1_785_283_200,
          current_period_end: 1_787_961_600,
          price: {
            currency: 'usd',
            unit_amount: 12500,
            recurring: { interval: 'month', interval_count: 1 },
          },
        },
      ],
    },
  } as unknown as Stripe.Subscription
}

function eventFor(subscription: Stripe.Subscription): Stripe.Event {
  return createMockStripeEvent('customer.subscription.created', subscription)
}

function queueSuccessfulExistingSubscriptionReconciliation(options: {
  operation?: ReturnType<typeof operationPayload>
  existingMetadata?: Record<string, unknown>
}) {
  queueTableRows(schemaMock.organization, [{ creditBalance: '0' }])
  if (options.operation) {
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: options.operation },
    ])
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: options.operation },
    ])
    queueTableRows(schemaMock.user, [{ stripeCustomerId: 'cus_1' }])
  }
  queueTableRows(schemaMock.member, [{ value: 1 }])
  queueTableRows(schemaMock.member, [])
  queueTableRows(schemaMock.subscription, [])
  queueTableRows(schemaMock.subscription, [
    {
      id: 'local-sub-1',
      referenceId: 'org-1',
      status: 'active',
      metadata: options.existingMetadata ?? {},
    },
  ])
  queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
}

describe('Enterprise webhook issuance correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.patchOutboxEventPayload.mockResolvedValue(true)
    mocks.reapplyPaidOrgJoinBillingForExistingMemberTx.mockResolvedValue(undefined)
    mocks.enqueueOutboxEvent.mockResolvedValue('move-event')
    mocks.enqueueOutboxEvents.mockResolvedValue(['move-event'])
    mocks.getEnterpriseIssuanceSeatRequirement.mockResolvedValue({ requiredSeats: 1 })
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('retries when the create webhook races ahead of paused-collection provisioning', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueTableRows(schemaMock.outboxEvent, [
      {
        eventType: ENTERPRISE_PROVISION_EVENT_TYPE,
        payload: operationPayload({ pausePaymentCollection: true }),
      },
    ])
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.organization, [{ creditBalance: '0' }])
    queueTableRows(schemaMock.outboxEvent, [
      {
        eventType: ENTERPRISE_PROVISION_EVENT_TYPE,
        payload: operationPayload({ pausePaymentCollection: true }),
      },
    ])
    queueTableRows(schemaMock.user, [{ stripeCustomerId: 'cus_1' }])

    await expect(handleManualEnterpriseSubscription(eventFor(subscription))).rejects.toThrow(
      'Enterprise issuance operation operation-1 does not yet match the Stripe subscription'
    )

    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.patchOutboxEventPayload).not.toHaveBeenCalled()
    expect(mocks.reapplyPaidOrgJoinBillingForExistingMemberTx).not.toHaveBeenCalled()
  })

  it('queues the exact selected Enterprise owner workspaces after issuance is applied', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({ workspaceIds: ['workspace-1', 'workspace-archived'] }),
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.enqueueOutboxEvents).toHaveBeenCalledWith(
      expect.anything(),
      'enterprise.move-workspace',
      [
        expect.objectContaining({ workspaceId: 'workspace-1', sequence: 0 }),
        expect.objectContaining({ workspaceId: 'workspace-archived', sequence: 1 }),
      ]
    )
    expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      'enterprise.reconcile-members',
      expect.objectContaining({ organizationId: 'org-1', afterUserId: null })
    )
    expect(mocks.patchOutboxEventPayload).toHaveBeenCalled()
  })

  it('does not discover owner workspaces that were not selected at confirmation', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({ workspaceIds: ['workspace-1'] }),
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.enqueueOutboxEvents).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueOutboxEvents).toHaveBeenCalledWith(
      expect.anything(),
      'enterprise.move-workspace',
      [expect.objectContaining({ workspaceId: 'workspace-1' })]
    )
  })

  it('queues creation invitations and revokes the owner session only after verified apply', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
        logoutOwnerOnApply: true,
      }),
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.enqueueOutboxEvents).toHaveBeenCalledWith(
      expect.anything(),
      'enterprise.invite-people',
      [
        expect.objectContaining({
          email: 'new@example.com',
          organizationId: 'org-1',
          sequence: 0,
        }),
      ]
    )
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.session)
    expect(dbChainMockFns.set.mock.calls).toContainEqual([
      expect.objectContaining({ securityPolicyVersion: expect.anything() }),
    ])
  })

  it('does not apply issuance children or logout until Stripe reports an entitled status', async () => {
    const subscription = stripeSubscription({
      operationId: 'operation-1',
      paused: false,
      status: 'incomplete',
    })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    mocks.getEnterpriseIssuanceSeatRequirement.mockResolvedValue({ requiredSeats: 99 })
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
        logoutOwnerOnApply: true,
      }),
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.enqueueOutboxEvents).not.toHaveBeenCalled()
    expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled()
    expect(mocks.patchOutboxEventPayload).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
    expect(dbChainMockFns.set.mock.calls).not.toContainEqual([
      expect.objectContaining({ securityPolicyVersion: expect.anything() }),
    ])
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'incomplete' })
    )
  })

  it('refuses an entitled issuance when live reservations outgrow its Stripe seat capacity', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', seats: 12 })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    mocks.getEnterpriseIssuanceSeatRequirement.mockResolvedValue({ requiredSeats: 13 })
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
      }),
    })

    await expect(handleManualEnterpriseSubscription(eventFor(subscription))).rejects.toThrow(
      'below 13 occupied or reserved seats'
    )

    expect(mocks.enqueueOutboxEvents).not.toHaveBeenCalled()
    expect(mocks.patchOutboxEventPayload).not.toHaveBeenCalled()
  })

  it('allows later Stripe metadata edits after the issuance was already applied', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload({ applied: true, pausePaymentCollection: true }),
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.patchOutboxEventPayload).not.toHaveBeenCalled()
  })

  it('continues to reconcile manual Enterprise subscriptions without an operation id', async () => {
    const subscription = stripeSubscription({})
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({})

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()
  })

  it('reconciles a duplicate event again so a stale generic webhook write is corrected', async () => {
    const subscription = stripeSubscription({})
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({})
    queueSuccessfulExistingSubscriptionReconciliation({})
    const event = eventFor(subscription)

    await expect(handleManualEnterpriseSubscription(event)).resolves.toBeUndefined()
    await expect(handleManualEnterpriseSubscription(event)).resolves.toBeUndefined()

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledTimes(2)
  })

  it('allows a later valid Stripe edit that retains an already-applied config marker', async () => {
    const subscription = stripeSubscription({
      configOperationId: 'config-1',
      seats: 14,
    })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      existingMetadata: { simConfigOperationId: 'config-1' },
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ seats: '14' }) })
    )
  })

  it('does not apply an unverified configuration delivery', async () => {
    const subscription = stripeSubscription({ configOperationId: 'config-unverified' })
    subscription.metadata.simConfigRevision = '2'
    subscription.metadata.simConfigDeliveryRevision = '1'
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueTableRows(schemaMock.organization, [{ creditBalance: '0' }])
    queueTableRows(schemaMock.member, [{ value: 1 }])
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.subscription, [
      {
        id: 'local-sub-1',
        referenceId: 'org-1',
        status: 'active',
        metadata: {},
      },
    ])
    queueTableRows(schemaMock.outboxEvent, [
      {
        eventType: 'stripe.sync-enterprise-metadata',
        payload: {
          subscriptionId: 'local-sub-1',
          revision: 2,
          deliveryRevision: 1,
          metadata: { plan: 'enterprise', referenceId: 'org-1', seats: 12 },
          stripeProgress: {},
          deliveryState: {
            priorPause: null,
            billingIntervalChanged: false,
            providerAcceptedAt: '2026-08-13T00:00:00.000Z',
          },
        },
      },
    ])

    await expect(handleManualEnterpriseSubscription(eventFor(subscription))).rejects.toThrow(
      'does not exactly match the Stripe subscription'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
