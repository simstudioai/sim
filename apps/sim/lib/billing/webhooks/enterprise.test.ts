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
  reapplyPaidOrgJoinBillingForExistingMemberTx: vi.fn(),
  acquireUserBillingIdentityLock: vi.fn(),
  acquireInvitationMutationLocks: vi.fn(),
  attachOwnedWorkspacesToOrganizationTx: vi.fn(),
  invalidateWorkspaceTableLimitsCache: vi.fn(),
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

vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mocks.acquireUserBillingIdentityLock,
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

vi.mock('@/lib/billing/webhooks/idempotency', () => ({
  stripeWebhookIdempotency: {
    executeWithIdempotency: vi.fn(
      async (_provider: string, _identifier: string, operation: () => Promise<unknown>) =>
        operation()
    ),
  },
}))

vi.mock('@/lib/core/outbox/service', () => ({
  patchOutboxEventPayload: mocks.patchOutboxEventPayload,
}))

vi.mock('@/lib/invitations/locks', () => ({
  acquireInvitationMutationLocks: mocks.acquireInvitationMutationLocks,
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

vi.mock('@/lib/table/billing', () => ({
  invalidateWorkspaceTableLimitsCache: mocks.invalidateWorkspaceTableLimitsCache,
}))

vi.mock('@/lib/workspaces/organization-workspaces', () => ({
  attachOwnedWorkspacesToOrganizationTx: mocks.attachOwnedWorkspacesToOrganizationTx,
  ownedAttachableWorkspacesWhere: vi.fn(),
}))

import { handleManualEnterpriseSubscription } from '@/lib/billing/webhooks/enterprise'

const ENTERPRISE_PROVISION_EVENT_TYPE = 'stripe.provision-enterprise'

function operationPayload(options: { applied?: boolean; pausePaymentCollection?: boolean } = {}) {
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
}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
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
      seats: '12',
      concurrencyLimit: '1250',
      ...(options.operationId ? { enterpriseOperationId: options.operationId } : {}),
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
  workspaceIds?: string[]
}) {
  queueTableRows(schemaMock.organization, [{ creditBalance: '0' }])
  if (options.operation) {
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: options.operation },
    ])
    if (!('applicationResult' in options.operation)) {
      const workspaceRows = (options.workspaceIds ?? []).map((id) => ({ id }))
      queueTableRows(schemaMock.workspace, workspaceRows)
      queueTableRows(schemaMock.workspace, workspaceRows)
    }
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: options.operation },
    ])
    queueTableRows(schemaMock.user, [{ stripeCustomerId: 'cus_1' }])
  }
  queueTableRows(schemaMock.member, [{ value: 1 }])
  queueTableRows(schemaMock.member, [])
  queueTableRows(schemaMock.subscription, [])
  queueTableRows(schemaMock.subscription, [{ id: 'local-sub-1', referenceId: 'org-1' }])
  queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
}

describe('Enterprise webhook issuance correlation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.patchOutboxEventPayload.mockResolvedValue(true)
    mocks.reapplyPaidOrgJoinBillingForExistingMemberTx.mockResolvedValue(undefined)
    mocks.attachOwnedWorkspacesToOrganizationTx.mockResolvedValue({
      attachedWorkspaceIds: [],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
    })
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

  it('sweeps the Enterprise owner personal workspaces when issuance is applied', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueSuccessfulExistingSubscriptionReconciliation({
      operation: operationPayload(),
      workspaceIds: ['workspace-1', 'workspace-archived'],
    })
    mocks.attachOwnedWorkspacesToOrganizationTx.mockResolvedValueOnce({
      attachedWorkspaceIds: ['workspace-1', 'workspace-archived'],
      addedMemberIds: [],
      skippedMembers: [],
      usageLimitUserIds: [],
    })

    await expect(
      handleManualEnterpriseSubscription(eventFor(subscription))
    ).resolves.toBeUndefined()

    expect(mocks.acquireInvitationMutationLocks).toHaveBeenCalledWith(expect.anything(), {
      invitationIds: [],
      workspaceIds: ['workspace-1', 'workspace-archived'],
    })
    expect(mocks.acquireUserBillingIdentityLock).toHaveBeenCalledWith(expect.anything(), 'owner-1')
    expect(mocks.attachOwnedWorkspacesToOrganizationTx).toHaveBeenCalledWith(expect.anything(), {
      ownerUserId: 'owner-1',
      organizationId: 'org-1',
      workspaceIds: ['workspace-1', 'workspace-archived'],
      externalMemberPolicy: 'external-all',
      ownerMatch: 'owner',
      includeArchived: true,
    })
    expect(mocks.invalidateWorkspaceTableLimitsCache).toHaveBeenCalledTimes(2)
    expect(mocks.patchOutboxEventPayload).toHaveBeenCalled()
  })

  it('retries without applying when the Enterprise owner workspace set changes', async () => {
    const subscription = stripeSubscription({ operationId: 'operation-1', paused: false })
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription)
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: operationPayload() },
    ])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    queueTableRows(schemaMock.organization, [{ creditBalance: '0' }])
    queueTableRows(schemaMock.outboxEvent, [
      { eventType: ENTERPRISE_PROVISION_EVENT_TYPE, payload: operationPayload() },
    ])
    queueTableRows(schemaMock.user, [{ stripeCustomerId: 'cus_1' }])
    queueTableRows(schemaMock.member, [{ value: 1 }])
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.subscription, [{ id: 'local-sub-1', referenceId: 'org-1' }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }, { id: 'workspace-2' }])

    await expect(handleManualEnterpriseSubscription(eventFor(subscription))).rejects.toThrow(
      'personal workspaces changed during reconciliation'
    )

    expect(mocks.attachOwnedWorkspacesToOrganizationTx).not.toHaveBeenCalled()
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
})
