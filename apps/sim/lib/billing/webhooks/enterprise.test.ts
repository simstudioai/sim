import { auditMock } from '@sim/testing/mocks/audit.mock'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { emailMailerMock } from '@sim/testing/mocks/email-mailer.mock'
import { emailTemplatesMock } from '@sim/testing/mocks/email-templates.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { schemaMock } from '@sim/testing/mocks/schema.mock'
import { createMockStripeEvent, stripeClientMock } from '@sim/testing/mocks/stripe.mock'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  getEnterpriseIssuanceSeatRequirement: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@sim/utils/id', () => idMock)

vi.mock('@/components/emails', () => emailTemplatesMock)

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)

vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  getEnterpriseIssuanceSeatRequirement: hoisted.getEnterpriseIssuanceSeatRequirement,
}))

vi.mock('@/lib/billing/stripe-client', () => stripeClientMock)

vi.mock('@/lib/billing/webhooks/enterprise-reconciliation-lease', () => ({
  assertEnterpriseReconciliationLeaseHeld: vi.fn(),
  withEnterpriseReconciliationLease: vi.fn(
    async (
      _subscriptionId: string,
      operation: (lease: { key: string; token: string }) => Promise<unknown>
    ) => operation({ key: 'test-lease', token: 'test-token' })
  ),
}))

vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

vi.mock('@/lib/messaging/email/utils', () => ({
  getFromEmailAddress: vi.fn(() => 'billing@sim.test'),
}))

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'

const mocks = {
  ...hoisted,
  reapplyPaidOrgJoinBillingForExistingMemberTx:
    organizationMembershipMockFns.mockReapplyPaidOrgJoinBillingForExistingMemberTx,
  enqueueOutboxEvent: outboxServiceMockFns.mockEnqueueOutboxEvent,
  enqueueOutboxEvents: outboxServiceMockFns.mockEnqueueOutboxEvents,
  patchOutboxEventPayload: outboxServiceMockFns.mockPatchOutboxEventPayload,
}

idMockFns.mockGenerateId.mockReturnValue('generated-id')
stripeClientMock.requireStripeClient.mockReturnValue({
  subscriptions: { retrieve: mocks.subscriptionsRetrieve },
})

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
