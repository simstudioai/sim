/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  subscriptionsCreate: vi.fn(),
  subscriptionsList: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  invoicesRetrieve: vi.fn(),
  invoicesUpdate: vi.fn(),
  customersCreate: vi.fn(),
  customersList: vi.fn(),
  productsCreate: vi.fn(),
  productsRetrieve: vi.fn(),
  pricesList: vi.fn(),
  pricesCreate: vi.fn(),
  pricesRetrieve: vi.fn(),
  enqueue: vi.fn(),
  patchPayload: vi.fn(),
  reapplyPaidOrgJoinBillingForExistingMemberTx: vi.fn(),
  prepareWorkspaceInvitationContext: vi.fn(),
  createWorkspaceInvitation: vi.fn(),
  sendInvitationEmail: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { ENTERPRISE_SUBSCRIPTION_PROVISIONED: 'subscription.enterprise_provisioned' },
  AuditResourceType: { SUBSCRIPTION: 'subscription' },
  recordAudit: vi.fn(),
  recordAuditOnce: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({ generateId: vi.fn(() => 'generated-id') }))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
  reapplyPaidOrgJoinBillingForExistingMemberTx: mocks.reapplyPaidOrgJoinBillingForExistingMemberTx,
}))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: vi.fn(),
}))
vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({
    customers: { create: mocks.customersCreate, list: mocks.customersList },
    products: { create: mocks.productsCreate, retrieve: mocks.productsRetrieve },
    prices: { list: mocks.pricesList, create: mocks.pricesCreate, retrieve: mocks.pricesRetrieve },
    subscriptions: {
      create: mocks.subscriptionsCreate,
      list: mocks.subscriptionsList,
      retrieve: mocks.subscriptionsRetrieve,
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
  continueOutboxHandler: (reason: string) => ({
    outcome: 'deferred',
    reason,
    consumeAttempt: false,
  }),
  deferOutboxHandler: (reason: string, minimumBackoffMs?: number, consumeAttempt = true) => ({
    outcome: 'deferred',
    reason,
    ...(minimumBackoffMs === undefined ? {} : { minimumBackoffMs }),
    ...(consumeAttempt ? {} : { consumeAttempt: false }),
  }),
  enqueueOutboxEvent: mocks.enqueue,
  outboxEventHasSourceOperationId: vi.fn(() => undefined),
  patchOutboxEventPayload: mocks.patchPayload,
}))
vi.mock('@/lib/invitations/workspace-invitations', () => ({
  prepareWorkspaceInvitationContext: mocks.prepareWorkspaceInvitationContext,
  createWorkspaceInvitation: mocks.createWorkspaceInvitation,
}))
vi.mock('@/lib/invitations/send', () => ({
  sendInvitationEmail: mocks.sendInvitationEmail,
}))

import {
  buildEnterpriseProvisioningRequestKey,
  computeEnterpriseIssuanceRequiredSeats,
  decideEnterpriseProvisioningIssue,
  decideEnterpriseProvisioningRetry,
  getEnterpriseIssuancePreflight,
  getLatestEnterpriseProvisionings,
  inviteEnterprisePeople,
  provisionEnterpriseInStripe,
  reconcileEnterpriseMembers,
  reviewEnterpriseProvisioning,
  syncEnterpriseMetadataInStripe,
} from '@/lib/billing/enterprise-provisioning'

afterAll(() => {
  resetDbChainMock()
})

describe('Enterprise issuance preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns a bounded workspace page with an authoritative matching total', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [])
    queueTableRows(schemaMock.workspace, [{ value: 3 }])
    queueTableRows(schemaMock.workspace, [
      { id: 'workspace-1', name: 'One', archivedAt: null },
      { id: 'workspace-2', name: 'Two', archivedAt: new Date('2026-01-01T00:00:00.000Z') },
    ])
    queueTableRows(schemaMock.workspace, [
      { id: 'workspace-1', name: 'One', archivedAt: null, total: 3 },
      {
        id: 'workspace-2',
        name: 'Two',
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
        total: 3,
      },
      { id: 'workspace-3', name: 'Three', archivedAt: null, total: 3 },
    ])

    await expect(
      getEnterpriseIssuancePreflight({
        ownerUserId: 'owner-1',
        search: '',
        limit: 2,
        offset: 0,
      })
    ).resolves.toMatchObject({
      personalWorkspaces: [
        { id: 'workspace-1', name: 'One', archived: false },
        { id: 'workspace-2', name: 'Two', archived: true },
      ],
      workspacePagination: { total: 3, limit: 2, offset: 0, hasMore: true },
      workspaceSelection: {
        totalEligible: 3,
        defaultSelectedIds: ['workspace-1', 'workspace-2', 'workspace-3'],
        defaultSelectedWorkspaces: [
          { id: 'workspace-1', name: 'One', archived: false },
          { id: 'workspace-2', name: 'Two', archived: true },
          { id: 'workspace-3', name: 'Three', archived: false },
        ],
        includesAllEligible: true,
        limit: 1_000,
      },
    })
  })

  it('does not silently choose an arbitrary subset when eligibility exceeds the issuance cap', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [])
    queueTableRows(schemaMock.workspace, [{ value: 1_001 }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1', name: 'One', archivedAt: null }])
    queueTableRows(
      schemaMock.workspace,
      Array.from({ length: 1_001 }, (_, index) => ({
        id: `workspace-${index + 1}`,
        name: `Workspace ${index + 1}`,
        archivedAt: null,
        total: 1_001,
      }))
    )

    const result = await getEnterpriseIssuancePreflight({
      ownerUserId: 'owner-1',
      search: '',
      limit: 1,
      offset: 0,
    })

    expect(result.workspaceSelection).toEqual({
      totalEligible: 1_001,
      defaultSelectedIds: [],
      defaultSelectedWorkspaces: [],
      includesAllEligible: false,
      limit: 1_000,
    })
  })

  it('previews backdated ledger usage, prepaid balance, and the effective default limit', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [
      {
        role: 'owner',
        organizationId: 'org-1',
        organizationName: 'Acme',
        organizationCreditBalance: '25',
      },
    ])
    queueTableRows(schemaMock.workspace, [{ value: 0 }])
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.subscription, [])
    queueTableRows(schemaMock.usageLog, [{ cost: '150' }])

    const result = await getEnterpriseIssuancePreflight({
      ownerUserId: 'owner-1',
      search: '',
      limit: 1,
      offset: 0,
      invoiceAmountUsd: 1_200,
      billingInterval: 'year',
      reportingPeriodAnchorDate: '2026-08-01',
    })

    expect(result.billingPreview).toMatchObject({
      reportingPeriod: {
        anchorDate: '2026-08-01',
        interval: 'year',
        currentStart: '2026-08-01T00:00:00.000Z',
        currentEnd: '2027-08-01T00:00:00.000Z',
        source: 'reporting',
      },
      usage: { usedDollars: 150, limitDollars: 1_225 },
      configuredUsageLimitDollars: 1_200,
      prepaidBalanceDollars: 25,
      effectiveUsageLimitDollars: 1_225,
      exceedsLimit: false,
    })
  })

  it('reviews exact selected-workspace invitation reservations before issuance', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [])
    queueTableRows(schemaMock.workspace, [{ value: 1 }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1', name: 'One', archivedAt: null }])
    queueTableRows(schemaMock.workspace, [
      { id: 'workspace-1', name: 'One', archivedAt: null, total: 1 },
    ])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    queueTableRows(schemaMock.invitation, [{ email: 'pending@example.com' }])

    await expect(
      reviewEnterpriseProvisioning({
        ownerUserId: 'owner-1',
        organizationName: 'Acme',
        invoiceAmountUsd: 1_200,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2026-08-01',
        workspaceIds: ['workspace-1'],
        invitations: [],
        seats: 1,
      })
    ).resolves.toMatchObject({
      workspaceSelection: { selected: 1 },
      invitations: {
        requested: 0,
        additionalSeatReservationsFromWorkspaceSweep: 1,
      },
      seats: {
        memberSeats: 1,
        pendingSeats: 0,
        migratedPendingSeats: 1,
        newInvitationSeats: 0,
        requiredSeats: 2,
        capacity: 1,
        sufficient: false,
      },
    })
  })

  it('blocks an oversized workspace-sweep invitation expansion without truncating it', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [])
    queueTableRows(schemaMock.workspace, [{ value: 1 }])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1', name: 'One', archivedAt: null }])
    queueTableRows(schemaMock.workspace, [
      { id: 'workspace-1', name: 'One', archivedAt: null, total: 1 },
    ])
    queueTableRows(schemaMock.workspace, [{ id: 'workspace-1' }])
    queueTableRows(
      schemaMock.invitation,
      Array.from({ length: 10_001 }, (_, index) => ({ email: `pending-${index}@example.com` }))
    )

    await expect(
      reviewEnterpriseProvisioning({
        ownerUserId: 'owner-1',
        organizationName: 'Acme',
        invoiceAmountUsd: 1_200,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2026-08-01',
        workspaceIds: ['workspace-1'],
        invitations: [],
        seats: 10_001,
      })
    ).rejects.toThrow('none were omitted')
  })

  it('returns a product error for an invalid reporting anchor', async () => {
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.member, [])
    queueTableRows(schemaMock.workspace, [{ value: 0 }])
    queueTableRows(schemaMock.workspace, [])
    queueTableRows(schemaMock.workspace, [])

    await expect(
      getEnterpriseIssuancePreflight({
        ownerUserId: 'owner-1',
        search: '',
        limit: 1,
        offset: 0,
        invoiceAmountUsd: 1_200,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2026-02-30',
      })
    ).rejects.toThrow('Reporting period anchor must be a valid UTC date on or before today')
  })
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
  it('reserves seats only for invitations that do not already occupy or reserve one', () => {
    expect(
      computeEnterpriseIssuanceRequiredSeats({
        memberSeats: 4,
        pendingSeats: 2,
        invitationEmails: ['member@example.com', 'pending@example.com', 'new@example.com'],
        existingMemberEmails: new Set(['member@example.com']),
        pendingInvitationEmails: new Set(['pending@example.com']),
      })
    ).toBe(7)
  })

  it('includes distinct pending internal invitees carried by the workspace sweep', () => {
    expect(
      computeEnterpriseIssuanceRequiredSeats({
        memberSeats: 1,
        pendingSeats: 1,
        invitationEmails: ['explicit@example.com', 'overlap@example.com'],
        migratedInvitationEmails: [
          'moved@example.com',
          'moved@example.com',
          'overlap@example.com',
          'member@example.com',
          'pending@example.com',
        ],
        existingMemberEmails: new Set(['member@example.com']),
        pendingInvitationEmails: new Set(['pending@example.com']),
      })
    ).toBe(5)
  })

  it('includes the configured or invoice-defaulted usage limit in the request key', () => {
    const input = {
      ownerUserId: 'owner-1',
      invoiceAmountUsd: 125,
      reportingPeriodAnchorDate: '2026-08-01',
      usageLimitCredits: 24000,
      seats: 12,
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
    }
    const normalizedTerms = {
      billingInterval: 'year' as const,
      reportingPeriodAnchorDate: '2026-08-01',
    }

    expect(buildEnterpriseProvisioningRequestKey(input, 'org-1', normalizedTerms)).toBe(
      'enterprise-v6:owner-1:org-1:12500:year:2026-08-01:::24000:12:concurrency=default:workflow-timeout=default:collection=active'
    )
    expect(
      buildEnterpriseProvisioningRequestKey(
        { ...input, concurrencyLimit: 1250 },
        'org-1',
        normalizedTerms
      )
    ).toBe(
      'enterprise-v6:owner-1:org-1:12500:year:2026-08-01:::24000:12:concurrency=1250:workflow-timeout=default:collection=active'
    )
    expect(
      buildEnterpriseProvisioningRequestKey(
        { ...input, pausePaymentCollection: true },
        'org-1',
        normalizedTerms
      )
    ).toBe(
      'enterprise-v6:owner-1:org-1:12500:year:2026-08-01:::24000:12:concurrency=default:workflow-timeout=default:collection=paused'
    )
    expect(
      buildEnterpriseProvisioningRequestKey(
        { ...input, usageLimitCredits: undefined },
        'org-1',
        normalizedTerms
      )
    ).toBe(
      'enterprise-v6:owner-1:org-1:12500:year:2026-08-01:::25000:12:concurrency=default:workflow-timeout=default:collection=active'
    )
  })

  it('includes normalized creation-time invitations in the idempotency key', () => {
    const normalizedTerms = {
      billingInterval: 'year' as const,
      reportingPeriodAnchorDate: '2026-08-01',
    }
    const base = {
      ownerUserId: 'owner-1',
      invoiceAmountUsd: 125,
      seats: 12,
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
    }
    const first = buildEnterpriseProvisioningRequestKey(
      {
        ...base,
        invitations: [
          { email: 'B@Example.com', role: 'member' as const, permission: 'write' as const },
          { email: 'a@example.com', role: 'admin' as const, permission: 'admin' as const },
        ],
      },
      'org-1',
      normalizedTerms
    )
    const reordered = buildEnterpriseProvisioningRequestKey(
      {
        ...base,
        invitations: [
          { email: 'a@example.com', role: 'admin' as const, permission: 'admin' as const },
          { email: 'b@example.com', role: 'member' as const, permission: 'write' as const },
        ],
      },
      'org-1',
      normalizedTerms
    )

    expect(first).toBe(reordered)
    expect(first).toContain('a@example.com,admin,admin;b@example.com,member,write')
  })

  it('keeps concurrency and workflow timeout in distinct request-key slots', () => {
    const input = {
      ownerUserId: 'owner-1',
      invoiceAmountUsd: 125,
      reportingPeriodAnchorDate: '2026-08-01',
      usageLimitCredits: 24000,
      seats: 12,
      requestedByEmail: 'admin@sim.ai',
      requestedByUserId: 'admin-1',
    }

    const concurrencyKey = buildEnterpriseProvisioningRequestKey(
      { ...input, concurrencyLimit: 100 },
      'org-1',
      { billingInterval: 'year', reportingPeriodAnchorDate: '2026-08-01' }
    )
    const workflowTimeoutKey = buildEnterpriseProvisioningRequestKey(
      { ...input, workflowExecutionTimeoutSeconds: 100 },
      'org-1',
      { billingInterval: 'year', reportingPeriodAnchorDate: '2026-08-01' }
    )

    expect(concurrencyKey).not.toBe(workflowTimeoutKey)
    expect(concurrencyKey).toContain('concurrency=100:workflow-timeout=default')
    expect(workflowTimeoutKey).toContain('concurrency=default:workflow-timeout=100')
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

describe('Enterprise workspace-move progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('keeps the total failed count visible when list views omit bounded failure details', async () => {
    const payload = operationPayload({
      request: {
        ...operationPayload().request,
        workspaceIds: ['workspace-1', 'workspace-2', 'workspace-3'],
      },
    })
    const now = new Date('2026-08-13T00:00:00.000Z')
    queueTableRows(schemaMock.outboxEvent, [
      {
        id: 'operation-1',
        eventType: 'stripe.provision-enterprise',
        status: 'pending',
        payload,
        attempts: 0,
        maxAttempts: 5,
        availableAt: now,
        lockedAt: null,
        processedAt: null,
        lastError: null,
        createdAt: now,
      },
    ])
    queueTableRows(schemaMock.outboxEvent, [{ operationId: 'operation-1', moved: 1, failed: 1 }])

    const provisionings = await getLatestEnterpriseProvisionings(['org-1'])

    expect(provisionings.get('org-1')?.workspaceMoves).toEqual({
      selected: 3,
      moved: 1,
      pending: 1,
      failedCount: 1,
      failed: [],
    })
  })

  it('surfaces correlated follow-up completion and dead-letter totals', async () => {
    const payload = operationPayload()
    const now = new Date('2026-08-13T00:00:00.000Z')
    queueTableRows(schemaMock.outboxEvent, [
      {
        id: 'operation-1',
        eventType: 'stripe.provision-enterprise',
        status: 'completed',
        payload,
        attempts: 0,
        maxAttempts: 5,
        availableAt: now,
        lockedAt: null,
        processedAt: now,
        lastError: null,
        createdAt: now,
      },
    ])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [
      { operationId: 'operation-1', selected: 3, completed: 1, failed: 1 },
    ])

    const provisionings = await getLatestEnterpriseProvisionings(['org-1'])

    expect(provisionings.get('org-1')?.followUpJobs).toEqual({
      selected: 3,
      completed: 1,
      pending: 1,
      failedCount: 1,
      failed: [],
    })

    const renderedJoin = JSON.stringify(dbChainMockFns.innerJoin.mock.calls[0]?.[0])
    expect(renderedJoin).toContain("::jsonb -> 'sourceOperationIds'")
    expect(renderedJoin).toContain('jsonb_typeof')

    const renderedFilters = dbChainMockFns.where.mock.calls
      .map(([condition]) => JSON.stringify(condition))
      .join('\n')
    expect(renderedFilters).toContain("::jsonb -> 'sourceOperationIds'")
    expect(renderedFilters).toContain('?|')
  })

  it('rejects provisioning lookups larger than one admin page', async () => {
    await expect(
      getLatestEnterpriseProvisionings(Array.from({ length: 251 }, (_, index) => `org-${index}`))
    ).rejects.toThrow('limited to 250 organizations')
  })

  it('only loads workspace-move failure details for one organization', async () => {
    await expect(
      getLatestEnterpriseProvisionings(['org-1', 'org-2'], {
        includeWorkspaceMoveFailures: true,
      })
    ).rejects.toThrow('require exactly one organization')
  })
})

describe('Enterprise member reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.reapplyPaidOrgJoinBillingForExistingMemberTx.mockResolvedValue(undefined)
  })

  it('processes at most one bounded member page and checkpoints the cursor', async () => {
    queueTableRows(
      schemaMock.member,
      Array.from({ length: 51 }, (_, index) => ({
        userId: `user-${String(index).padStart(3, '0')}`,
      }))
    )
    const checkpointPayload = vi.fn()

    await expect(
      reconcileEnterpriseMembers(
        { organizationId: 'org-1', afterUserId: null },
        {
          eventId: 'reconcile-1',
          eventType: 'enterprise.reconcile-members',
          attempts: 0,
          checkpointPayload,
        }
      )
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Continuing bounded Enterprise member reconciliation',
      consumeAttempt: false,
    })

    expect(mocks.reapplyPaidOrgJoinBillingForExistingMemberTx).toHaveBeenCalledTimes(50)
    expect(checkpointPayload).toHaveBeenCalledWith({ afterUserId: 'user-049' })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(51)
  })
})

describe('Enterprise creation invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.sendInvitationEmail.mockResolvedValue({ success: true })
    mocks.createWorkspaceInvitation.mockResolvedValue({ id: 'new-invitation' })
    mocks.prepareWorkspaceInvitationContext.mockResolvedValue({
      inviterId: 'owner-1',
      inviterName: 'Owner',
      inviterEmail: 'owner@example.com',
      organizationId: 'org-1',
      targets: [
        {
          workspaceId: 'workspace-1',
          workspaceDetails: { name: 'Workspace 1' },
        },
      ],
    })
  })

  it('waits without consuming attempts until every selected workspace move completes', async () => {
    const payload = operationPayload({
      request: {
        ...operationPayload().request,
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
      },
      applicationResult: {
        appliedAt: '2026-08-13T00:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    queueTableRows(schemaMock.outboxEvent, [{ eventType: 'stripe.provision-enterprise', payload }])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [{ status: 'pending' }])

    await expect(
      inviteEnterprisePeople(
        {
          provisioningOperationId: 'operation-1',
          organizationId: 'org-1',
          ownerUserId: 'owner-1',
          email: 'new@example.com',
          role: 'member',
          permission: 'write',
          sequence: 0,
        },
        {
          eventId: 'invite-1',
          eventType: 'enterprise.invite-people',
          attempts: 0,
          checkpointPayload: vi.fn(),
        }
      )
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Waiting for the Enterprise workspace sweep before sending invitations',
      consumeAttempt: false,
    })

    expect(mocks.prepareWorkspaceInvitationContext).not.toHaveBeenCalled()
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()
  })

  it('resends an exact pending invitation instead of treating its row as delivered', async () => {
    const payload = operationPayload({
      request: {
        ...operationPayload().request,
        requestedByName: 'Platform Admin',
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
      },
      applicationResult: {
        appliedAt: '2026-08-13T00:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    queueTableRows(schemaMock.outboxEvent, [{ eventType: 'stripe.provision-enterprise', payload }])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [{ status: 'completed' }])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.invitation, [
      {
        id: 'pending-invitation',
        token: 'pending-token',
        role: 'member',
        membershipIntent: 'internal',
        workspaceId: 'workspace-1',
        permission: 'write',
      },
    ])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.invitation, [
      {
        id: 'pending-invitation',
        token: 'pending-token',
        role: 'member',
        membershipIntent: 'internal',
        workspaceId: 'workspace-1',
        permission: 'write',
      },
    ])
    const checkpointPayload = vi.fn()

    await expect(
      inviteEnterprisePeople(
        {
          provisioningOperationId: 'operation-1',
          organizationId: 'org-1',
          ownerUserId: 'owner-1',
          email: 'new@example.com',
          role: 'member',
          permission: 'write',
          sequence: 0,
        },
        {
          eventId: 'invite-1',
          eventType: 'enterprise.invite-people',
          attempts: 1,
          checkpointPayload,
        }
      )
    ).resolves.toBeUndefined()

    expect(mocks.sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: 'pending-invitation',
        token: 'pending-token',
        email: 'new@example.com',
      })
    )
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()
    expect(checkpointPayload).toHaveBeenCalledWith({
      delivery: {
        completedAt: expect.any(String),
        resultId: 'pending-invitation',
        outcome: 'sent',
      },
    })
  })

  it('refuses to complete over a weaker pending workspace grant', async () => {
    const payload = operationPayload({
      request: {
        ...operationPayload().request,
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
      },
      applicationResult: {
        appliedAt: '2026-08-13T00:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    queueTableRows(schemaMock.outboxEvent, [{ eventType: 'stripe.provision-enterprise', payload }])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [{ status: 'completed' }])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.invitation, [
      {
        id: 'pending-invitation',
        token: 'pending-token',
        role: 'member',
        membershipIntent: 'internal',
        workspaceId: 'workspace-1',
        permission: 'read',
      },
    ])
    const checkpointPayload = vi.fn()

    await expect(
      inviteEnterprisePeople(
        {
          provisioningOperationId: 'operation-1',
          organizationId: 'org-1',
          ownerUserId: 'owner-1',
          email: 'new@example.com',
          role: 'member',
          permission: 'write',
          sequence: 0,
        },
        {
          eventId: 'invite-1',
          eventType: 'enterprise.invite-people',
          attempts: 1,
          checkpointPayload,
        }
      )
    ).rejects.toThrow('weaker pending grant')
    expect(mocks.sendInvitationEmail).not.toHaveBeenCalled()
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()
    expect(checkpointPayload).not.toHaveBeenCalled()
  })

  it('resends a stronger pending grant without downgrading it', async () => {
    const payload = operationPayload({
      request: {
        ...operationPayload().request,
        workspaceIds: ['workspace-1'],
        invitations: [{ email: 'new@example.com', role: 'member', permission: 'write' }],
      },
      applicationResult: {
        appliedAt: '2026-08-13T00:00:00.000Z',
        subscriptionId: 'sub-1',
      },
    })
    const pendingGrant = {
      id: 'pending-invitation',
      token: 'pending-token',
      role: 'member',
      membershipIntent: 'internal',
      workspaceId: 'workspace-1',
      permission: 'admin',
    }
    queueTableRows(schemaMock.outboxEvent, [{ eventType: 'stripe.provision-enterprise', payload }])
    queueTableRows(schemaMock.outboxEvent, [])
    queueTableRows(schemaMock.outboxEvent, [{ status: 'completed' }])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.invitation, [pendingGrant])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.user, [{ id: 'owner-1', name: 'Owner', email: 'owner@example.com' }])
    queueTableRows(schemaMock.user, [])
    queueTableRows(schemaMock.invitation, [pendingGrant])
    const checkpointPayload = vi.fn()

    await inviteEnterprisePeople(
      {
        provisioningOperationId: 'operation-1',
        organizationId: 'org-1',
        ownerUserId: 'owner-1',
        email: 'new@example.com',
        role: 'member',
        permission: 'write',
        sequence: 0,
      },
      {
        eventId: 'invite-1',
        eventType: 'enterprise.invite-people',
        attempts: 1,
        checkpointPayload,
      }
    )

    expect(mocks.sendInvitationEmail).toHaveBeenCalled()
    expect(mocks.createWorkspaceInvitation).not.toHaveBeenCalled()
    expect(checkpointPayload).toHaveBeenCalledWith({
      delivery: {
        completedAt: expect.any(String),
        resultId: 'pending-invitation',
        outcome: 'sent',
      },
    })
  })
})

describe('Enterprise issuance outbox handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      items: { data: [] },
      schedule: null,
    })
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

  it('creates an annual Price when the issuance cadence is yearly', async () => {
    arrangeWorkerReads()
    mocks.pricesRetrieve.mockResolvedValue({
      id: 'price_1',
      currency: 'usd',
      unit_amount: 120000,
      recurring: { interval: 'year' },
      product: 'prod_1',
      metadata: { enterpriseOperationId: 'operation-1' },
    })
    const annual = operationPayload({
      request: {
        ...operationPayload().request,
        requestKey: 'enterprise-v5:annual',
        invoiceAmountCents: 120000,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2026-08-01',
      },
    })

    await provisionEnterpriseInStripe(annual, context())

    expect(mocks.productsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        default_price_data: expect.objectContaining({
          unit_amount: 120000,
          recurring: { interval: 'year' },
        }),
      }),
      expect.any(Object)
    )
    expect(mocks.subscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          invoiceAmountCents: '120000',
          reportingPeriodAnchorDate: '2026-08-01',
          reportingPeriodInterval: 'year',
        }),
      }),
      expect.any(Object)
    )
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
      'seat capacity is below current occupied or reserved seats'
    )

    expect(mocks.subscriptionsCreate).not.toHaveBeenCalled()
  })

  it('rechecks pending seat reservations immediately before Stripe create', async () => {
    arrangeWorkerReads([], [], 1)
    queueTableRows(schemaMock.invitation, [{ count: 12 }])

    await expect(provisionEnterpriseInStripe(operationPayload(), context())).rejects.toThrow(
      'seat capacity is below current occupied or reserved seats'
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
        reportingPeriodAnchorDate: '2026-05-01',
        reportingPeriodInterval: 'year',
      },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-1', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
    })
    mocks.subscriptionsUpdate.mockResolvedValue({
      id: 'sub_1',
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
    })
    const checkpointPayload = vi.fn()

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-1',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload,
      })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Waiting for the verified Stripe webhook acknowledgement',
      minimumBackoffMs: 30_000,
      consumeAttempt: false,
    })

    expect(checkpointPayload).toHaveBeenCalledWith({
      acknowledgement: {
        startedAt: expect.any(String),
        deadlineAt: expect.any(String),
      },
    })

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_1',
      {
        metadata: expect.objectContaining({
          seats: '15',
          concurrencyLimit: '1250',
          reportingPeriodAnchorDate: '2026-05-01',
          reportingPeriodInterval: 'year',
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
    expect(mocks.pricesCreate).not.toHaveBeenCalled()
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
  })

  it('does not send a seat decrease below current pending reservations to Stripe', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 5,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
      },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-capacity', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    queueTableRows(schemaMock.invitation, [{ count: 6 }])

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-capacity',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).rejects.toThrow('seat intent is below current occupied or reserved seats')

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
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
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      pause_collection: null,
    })
    mocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_1', pause_collection: null })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-2',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason: 'Waiting for the verified Stripe webhook acknowledgement',
      minimumBackoffMs: 30_000,
      consumeAttempt: false,
    })

    expect(mocks.subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          concurrencyLimit: '',
          simConfigOperationId: 'metadata-event-2',
        }),
      }),
      expect.any(Object)
    )
  })

  it('does not consume attempts while a written Stripe delivery is inside its webhook grace period', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 6,
      deliveryRevision: 2,
      acknowledgement: {
        startedAt: '2026-08-13T00:00:00.000Z',
        deadlineAt: '2099-08-13T00:30:00.000Z',
      },
      deliveryState: {
        priorPause: null,
        billingIntervalChanged: false,
        providerAcceptedAt: '2026-08-13T00:00:00.000Z',
        verifiedAt: '2026-08-13T00:00:01.000Z',
      },
      metadata: { plan: 'enterprise', referenceId: 'org-1', seats: 15 },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-grace', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: '15',
        simConfigOperationId: 'metadata-event-grace',
        simConfigRevision: '6',
        simConfigDeliveryRevision: '2',
      },
    })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-grace',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 4,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
      reason: 'Waiting for the verified Stripe webhook acknowledgement',
    })

    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('retires an unapplied legacy commercial intent even when its seats are now too low', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 7,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 5,
        invoiceAmountCents: 120000,
        reportingPeriodAnchorDate: '2026-05-01',
      },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      stripeProgress: {},
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'legacy-terms-event', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      items: { data: [] },
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
    })
    const checkpointPayload = vi.fn()

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'legacy-terms-event',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 7,
        checkpointPayload,
      })
    ).resolves.toBeUndefined()

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(checkpointPayload).toHaveBeenCalledWith({
      commercialTermsRetiredAt: expect.any(String),
    })
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
    expect(mocks.pricesCreate).not.toHaveBeenCalled()
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
  })

  it('finishes verification when Stripe already contains an accepted legacy commercial intent', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 7,
      deliveryRevision: 2,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        invoiceAmountCents: 120000,
        reportingPeriodAnchorDate: '2026-05-01',
      },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      commercialTermsRetiredAt: '2026-08-21T18:01:00.000Z',
      deliveryState: {
        priorPause: { behavior: 'keep_as_draft' as const, resumesAt: null },
        billingIntervalChanged: true,
        providerAcceptedAt: '2026-08-21T18:00:00.000Z',
      },
      stripeProgress: { priceId: 'price_year' },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'accepted-legacy-terms-event', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: '15',
        invoiceAmountCents: '120000',
        reportingPeriodAnchorDate: '2026-05-01',
        simConfigOperationId: 'accepted-legacy-terms-event',
        simConfigRevision: '7',
        simConfigDeliveryRevision: '2',
      },
      collection_method: 'send_invoice',
      days_until_due: 30,
      schedule: null,
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
      items: {
        data: [
          {
            quantity: 1,
            price: {
              currency: 'usd',
              unit_amount: 120000,
              recurring: { interval: 'year', interval_count: 1 },
            },
          },
        ],
      },
    })
    const checkpointPayload = vi.fn()

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'accepted-legacy-terms-event',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 7,
        checkpointPayload,
      })
    ).resolves.toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
      reason: 'Waiting for the verified Stripe webhook acknowledgement',
    })

    expect(checkpointPayload).toHaveBeenNthCalledWith(1, {
      deliveryState: expect.objectContaining({
        providerAcceptedAt: '2026-08-21T18:00:00.000Z',
        verifiedAt: expect.any(String),
      }),
    })
    expect(checkpointPayload).toHaveBeenNthCalledWith(2, {
      acknowledgement: expect.objectContaining({
        startedAt: expect.any(String),
        deadlineAt: expect.any(String),
      }),
    })
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
    expect(mocks.pricesCreate).not.toHaveBeenCalled()
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
  })

  it('keeps an accepted legacy commercial intent fail-closed when Stripe no longer matches', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 7,
      deliveryRevision: 2,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        invoiceAmountCents: 120000,
        reportingPeriodAnchorDate: '2026-05-01',
      },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      commercialTermsRetiredAt: '2026-08-21T18:01:00.000Z',
      deliveryState: {
        priorPause: { behavior: 'keep_as_draft' as const, resumesAt: null },
        billingIntervalChanged: true,
        providerAcceptedAt: '2026-08-21T18:00:00.000Z',
      },
      stripeProgress: { priceId: 'price_year' },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'accepted-legacy-terms-event', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      items: { data: [] },
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
    })
    const checkpointPayload = vi.fn()

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'accepted-legacy-terms-event',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 7,
        checkpointPayload,
      })
    ).rejects.toThrow(
      'Legacy Enterprise commercial terms were accepted by Stripe but no longer match; manual reconciliation is required'
    )

    expect(checkpointPayload).not.toHaveBeenCalledWith({
      commercialTermsRetiredAt: expect.any(String),
    })
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
    expect(mocks.pricesCreate).not.toHaveBeenCalled()
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
  })

  it('consumes the finite missing-ack budget only after the durable grace deadline', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 6,
      deliveryRevision: 2,
      acknowledgement: {
        startedAt: '2000-08-13T00:00:00.000Z',
        deadlineAt: '2000-08-13T00:30:00.000Z',
      },
      metadata: { plan: 'enterprise', referenceId: 'org-1', seats: 15 },
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-missing', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {
        simConfigOperationId: 'metadata-event-missing',
        simConfigDeliveryRevision: '2',
      },
    })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-missing',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 4,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toEqual({
      outcome: 'deferred',
      reason:
        'Verified Stripe webhook acknowledgement was not received before the acknowledgement deadline',
    })
  })

  it('does not replace a Stripe Price for a legacy interval-change intent', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 6,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        invoiceAmountCents: 120000,
        reportingPeriodAnchorDate: '2026-01-31',
      },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      stripeProgress: {},
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-3', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      schedule: null,
      collection_method: 'send_invoice',
      days_until_due: 30,
      items: {
        data: [{ id: 'si_1', price: { product: 'prod_1' } }],
      },
    })
    mocks.pricesList.mockResolvedValue({ data: [], has_more: false })
    mocks.pricesCreate.mockResolvedValue({
      id: 'price_year',
      currency: 'usd',
      unit_amount: 120000,
      recurring: { interval: 'year', interval_count: 1 },
      product: 'prod_1',
      metadata: { enterpriseConfigOperationId: 'metadata-event-3' },
    })
    mocks.subscriptionsUpdate.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      items: { data: [] },
      pause_collection: null,
    })
    const checkpointPayload = vi.fn()

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-3',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload,
      })
    ).resolves.toBeUndefined()

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(mocks.pricesCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
    expect(checkpointPayload).toHaveBeenCalledWith({
      commercialTermsRetiredAt: expect.any(String),
    })
  })

  it('does not touch a paused subscription for a legacy commercial intent', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 7,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        invoiceAmountCents: 120000,
      },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      stripeProgress: {},
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-paused', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      schedule: null,
      collection_method: 'send_invoice',
      days_until_due: 30,
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
      items: {
        data: [
          {
            id: 'si_1',
            price: { product: 'prod_1', recurring: { interval: 'month', interval_count: 1 } },
          },
        ],
      },
    })
    mocks.pricesList.mockResolvedValue({ data: [], has_more: false })
    mocks.pricesCreate.mockResolvedValue({
      id: 'price_year',
      currency: 'usd',
      unit_amount: 120000,
      recurring: { interval: 'year', interval_count: 1 },
      product: 'prod_1',
      metadata: { enterpriseConfigOperationId: 'metadata-event-paused' },
    })
    mocks.subscriptionsUpdate.mockResolvedValue({
      id: 'sub_1',
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
      latest_invoice: { id: 'in_change', status: 'draft', auto_advance: true },
    })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-paused',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toBeUndefined()

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('does not inspect invoices for a legacy amount-change intent', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 8,
      deliveryRevision: 0,
      metadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 15,
        invoiceAmountCents: 150000,
      },
      terms: { invoiceAmountCents: 150000, billingInterval: 'year' as const },
      stripeProgress: {},
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-paused-amount', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      schedule: null,
      collection_method: 'send_invoice',
      days_until_due: 30,
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
      latest_invoice: { id: 'in_old', status: 'paid', auto_advance: false },
      items: {
        data: [
          {
            id: 'si_1',
            price: { product: 'prod_1', recurring: { interval: 'year', interval_count: 1 } },
          },
        ],
      },
    })
    mocks.pricesList.mockResolvedValue({ data: [], has_more: false })
    mocks.pricesCreate.mockResolvedValue({
      id: 'price_year_new_amount',
      currency: 'usd',
      unit_amount: 150000,
      recurring: { interval: 'year', interval_count: 1 },
      product: 'prod_1',
      metadata: { enterpriseConfigOperationId: 'metadata-event-paused-amount' },
    })
    mocks.subscriptionsUpdate.mockResolvedValue({
      id: 'sub_1',
      pause_collection: { behavior: 'keep_as_draft', resumes_at: null },
      latest_invoice: { id: 'in_old', status: 'paid', auto_advance: false },
    })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-paused-amount',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toBeUndefined()

    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(mocks.invoicesUpdate).not.toHaveBeenCalled()
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('retires a legacy billing-term intent without touching its Stripe Schedule', async () => {
    const payload = {
      subscriptionId: 'local-sub-1',
      revision: 6,
      deliveryRevision: 0,
      metadata: { plan: 'enterprise', referenceId: 'org-1', seats: 15 },
      terms: { invoiceAmountCents: 120000, billingInterval: 'year' as const },
      stripeProgress: {},
    }
    queueTableRows(schemaMock.subscription, [
      { stripeSubscriptionId: 'sub_1', referenceId: 'org-1', metadata: {} },
    ])
    queueTableRows(schemaMock.subscription, [{ metadata: {} }])
    queueTableRows(schemaMock.outboxEvent, [{ id: 'metadata-event-4', payload }])
    queueTableRows(schemaMock.member, [{ value: 10 }])
    mocks.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      metadata: {},
      schedule: 'sub_sched_1',
      collection_method: 'send_invoice',
      days_until_due: 30,
      items: { data: [{ id: 'si_1', price: { product: 'prod_1' } }] },
    })

    await expect(
      syncEnterpriseMetadataInStripe(payload, {
        eventId: 'metadata-event-4',
        eventType: 'stripe.sync-enterprise-metadata',
        attempts: 0,
        checkpointPayload: vi.fn(),
      })
    ).resolves.toBeUndefined()
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(mocks.subscriptionsUpdate).not.toHaveBeenCalled()
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
