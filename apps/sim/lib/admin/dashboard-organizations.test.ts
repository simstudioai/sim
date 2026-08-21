/** @vitest-environment node */

import {
  member,
  organization,
  permissions,
  subscription,
  usageLog,
  user,
  workspace,
} from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const mocks = vi.hoisted(() => ({
  provisionings: new Map(),
  resolveMetadataIntent: vi.fn(),
  enqueueOutboxEvent: vi.fn(),
  countPendingSeatInvitations: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))
/**
 * Cuts the import chain dashboard.ts -> admin-move.ts -> invitations/core ->
 * lib/auth/auth.ts. The auth module throws at import time when another suite
 * in this shared worker has clobbered NEXT_PUBLIC_APP_URL, which fails this
 * file's collection under `isolate: false`.
 */
vi.mock('@/lib/workspaces/admin-move', () => ({
  moveWorkspaceToOrganization: vi.fn(),
}))
/**
 * Keeps this suite from being the first loader of the real plan/usage modules
 * in the shared worker. Under `isolate: false` the first import freezes a
 * module's dependency bindings, which would break the dedicated plan/usage
 * suites when they run later with their own dependency mocks.
 */
vi.mock('@/lib/billing/core/plan', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))
vi.mock('@/lib/billing/core/usage', () => ({
  syncUsageLimitsFromSubscription: vi.fn(),
}))
vi.mock('@/lib/billing/enterprise-provisioning', () => ({
  getLatestEnterpriseProvisionings: vi.fn(async () => mocks.provisionings),
}))
vi.mock('@/lib/billing/enterprise-outbox', () => ({
  ENTERPRISE_METADATA_SYNC_EVENT_TYPE: 'stripe.sync-enterprise-metadata',
  enterpriseMetadataSyncPayloadSchema: { safeParse: vi.fn() },
  resolveEnterpriseMetadataIntent: mocks.resolveMetadataIntent,
}))
vi.mock('@/lib/billing/organizations/member-limits', () => ({ setOrgMemberUsageLimit: vi.fn() }))
vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: vi.fn(),
  ensureUserInOrganizationTx: vi.fn(),
  removeUserFromOrganization: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
}))
vi.mock('@/lib/billing/organizations/seats', () => ({ reconcileOrganizationSeats: vi.fn() }))
vi.mock('@/lib/billing/validation/seat-management', () => ({
  countPendingSeatInvitations: mocks.countPendingSeatInvitations,
}))
vi.mock('@/lib/core/idempotency/transaction', () => ({
  executeTransactionallyIdempotent: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: mocks.enqueueOutboxEvent }))

import {
  getDashboardMemberTransferPreflight,
  getDashboardOrganization,
  listDashboardOrganizations,
  toDashboardConfigurationUpdate,
  updateDashboardEnterpriseBillingTerms,
  updateDashboardEnterpriseSeats,
  updateDashboardOrganizationLimits,
} from '@/lib/admin/dashboard'

describe('getDashboardMemberTransferPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('pages workspace choices and exposes an empty default selection above the exact cap', async () => {
    queueTableRows(organization, [{ id: 'org-destination' }])
    queueTableRows(user, [
      {
        id: 'user-1',
        name: 'User',
        email: 'user@example.com',
        memberId: null,
        role: null,
        organizationId: null,
        organizationName: null,
      },
    ])
    queueTableRows(workspace, [{ value: 75 }])
    queueTableRows(workspace, [
      { id: 'workspace-51', name: 'Matching workspace', archivedAt: null },
    ])
    queueTableRows(workspace, [
      {
        id: 'workspace-1',
        name: 'First eligible workspace',
        archivedAt: null,
        total: 1_205,
      },
    ])

    const result = await getDashboardMemberTransferPreflight('org-destination', 'user-1', {
      search: 'matching',
      limit: 25,
      offset: 50,
    })

    expect(result.personalWorkspaces).toEqual([
      { id: 'workspace-51', name: 'Matching workspace', archived: false },
    ])
    expect(result.workspacePagination).toEqual({
      total: 75,
      limit: 25,
      offset: 50,
      hasMore: true,
    })
    expect(result.workspaceSelection).toEqual({
      totalEligible: 1_205,
      defaultSelectedIds: [],
      defaultSelectedWorkspaces: [],
      includesAllEligible: false,
      limit: 1_000,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1_001)
  })
})

describe('updateDashboardEnterpriseSeats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('refuses to reduce capacity below members plus live pending seat reservations', async () => {
    queueTableRows(subscription, [
      { id: 'sub-1', plan: 'enterprise', status: 'active', metadata: { seats: 10 } },
    ])
    queueTableRows(member, [{ value: 5 }])
    mocks.countPendingSeatInvitations.mockResolvedValue(2)

    await expect(
      updateDashboardEnterpriseSeats('org-1', 6, {
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@example.com',
      })
    ).rejects.toThrow('below 7 occupied or reserved seats')

    expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled()
  })
})

afterAll(() => {
  resetDbChainMock()
})

describe('toDashboardConfigurationUpdate', () => {
  it('converts the pending Stripe metadata intent without replacing applied values', () => {
    expect(
      toDashboardConfigurationUpdate({
        latestRevision: 2,
        desiredMetadata: {},
        desiredTerms: null,
        hasUnappliedIntent: true,
        effectiveSeatCapacity: 20,
        configurationUpdate: {
          id: 'config-2',
          status: 'pending',
          requestedMetadata: {
            usageLimitCredits: 10_000_000,
            seats: 20,
            concurrencyLimit: 50,
          },
          requestedTerms: null,
          error: null,
        },
      })
    ).toEqual({
      id: 'config-2',
      status: 'pending',
      requestedUsageLimitDollars: 50_000,
      requestedInvoiceAmountUsd: null,
      requestedBillingInterval: null,
      requestedReportingPeriodAnchorDate: null,
      requestedSeats: 20,
      requestedConcurrencyLimit: 50,
      requestedWorkflowExecutionTimeoutSeconds: null,
      error: null,
    })
  })
})

describe('listDashboardOrganizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.provisionings = new Map()
  })

  it('loads a page with a fixed batch of queries instead of querying once per organization', async () => {
    queueTableRows(organization, [{ total: 2 }])
    queueTableRows(organization, [
      { id: 'org-1', name: 'One', orgUsageLimit: '10', creditBalance: '1' },
      { id: 'org-2', name: 'Two', orgUsageLimit: '20', creditBalance: '2' },
    ])
    queueTableRows(member, [
      {
        organizationId: 'org-1',
        memberCount: 2,
        ownerId: 'owner-1',
        ownerName: 'Owner One',
        ownerEmail: 'one@example.com',
      },
      {
        organizationId: 'org-2',
        memberCount: 1,
        ownerId: 'owner-2',
        ownerName: 'Owner Two',
        ownerEmail: 'two@example.com',
      },
    ])
    queueTableRows(permissions, [{ organizationId: 'org-1', externalCollaboratorCount: 3 }])
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        referenceId: 'org-1',
        plan: 'team_6000',
        status: 'active',
        metadata: null,
      },
    ])

    const result = await listDashboardOrganizations({ search: '', limit: 50, offset: 0 })

    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      id: 'org-1',
      memberCount: 2,
      externalCollaboratorCount: 3,
      planLabel: 'Pro',
    })
    expect(result.data[1]).toMatchObject({
      id: 'org-2',
      memberCount: 1,
      externalCollaboratorCount: 0,
      planLabel: 'No plan',
    })
    // Pagination, membership/collaborators, and two batched usage aggregates.
    // This count remains constant regardless of the number of organizations.
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(6)
    expect(dbChainMockFns.selectDistinctOn).toHaveBeenCalledTimes(1)
  })

  it('preserves the frozen baseline for an Enterprise subscription using its Stripe period', async () => {
    queueTableRows(organization, [{ total: 1 }])
    queueTableRows(organization, [
      { id: 'org-1', name: 'One', orgUsageLimit: '100', creditBalance: '0' },
    ])
    queueTableRows(member, [
      {
        organizationId: 'org-1',
        memberCount: 1,
        ownerId: 'owner-1',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
      },
    ])
    queueTableRows(permissions, [])
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        referenceId: 'org-1',
        plan: 'enterprise',
        status: 'active',
        billingInterval: 'month',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-01T00:00:00.000Z'),
        metadata: { invoiceAmountCents: 10_000, seats: 1 },
      },
    ])
    queueTableRows(usageLog, [{ organizationId: 'org-1', cost: '2.5', workflowRuns: 3 }])
    queueTableRows(member, [{ organizationId: 'org-1', cost: '1.5' }])

    const result = await listDashboardOrganizations({ search: '', limit: 50, offset: 0 })

    expect(result.data[0]).toMatchObject({
      reportingPeriod: { source: 'stripe' },
      usage: { usedDollars: 4, workflowRuns: 3 },
    })
  })

  it('does not inject the frozen Stripe-period baseline into a custom reporting period', async () => {
    queueTableRows(organization, [{ total: 1 }])
    queueTableRows(organization, [
      { id: 'org-1', name: 'One', orgUsageLimit: '100', creditBalance: '0' },
    ])
    queueTableRows(member, [
      {
        organizationId: 'org-1',
        memberCount: 1,
        ownerId: 'owner-1',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
      },
    ])
    queueTableRows(permissions, [])
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        referenceId: 'org-1',
        plan: 'enterprise',
        status: 'active',
        billingInterval: 'year',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-01T00:00:00.000Z'),
        metadata: {
          invoiceAmountCents: 10_000,
          seats: 1,
          reportingPeriodAnchorDate: '2026-01-01',
        },
      },
    ])
    queueTableRows(usageLog, [{ organizationId: 'org-1', cost: '2.5', workflowRuns: 3 }])
    queueTableRows(member, [{ organizationId: 'org-1', cost: '1.5' }])

    const result = await listDashboardOrganizations({ search: '', limit: 50, offset: 0 })

    expect(result.data[0]).toMatchObject({
      reportingPeriod: { source: 'reporting', anchorDate: '2026-01-01', interval: 'year' },
      usage: { usedDollars: 2.5, workflowRuns: 3 },
    })
  })
})

describe('getDashboardOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.provisionings = new Map()
  })

  it('returns explicit counts and independent page metadata for bounded detail collections', async () => {
    queueTableRows(organization, [
      { id: 'org-1', name: 'One', orgUsageLimit: '100', creditBalance: '10' },
    ])
    queueTableRows(member, [{ value: 0 }])
    queueTableRows(permissions, [{ value: 0 }])
    queueTableRows(subscription, [])
    queueTableRows(member, [])
    queueTableRows(usageLog, [])
    queueTableRows(usageLog, [{ usedDollars: '12.5', actorCount: 2 }])
    queueTableRows(member, [])
    queueTableRows(member, [])
    queueTableRows(permissions, [])
    queueTableRows(workspace, [
      { id: 'workspace-1', name: 'One' },
      { id: 'workspace-2', name: 'Two' },
    ])
    queueTableRows(workspace, [{ value: 3 }])

    const result = await getDashboardOrganization('org-1', {
      limit: 2,
      memberOffset: 0,
      externalCollaboratorOffset: 0,
      workspaceOffset: 0,
    })

    expect(result).toMatchObject({
      memberPagination: { total: 0, limit: 2, offset: 0, hasMore: false },
      externalCollaboratorPagination: { total: 0, limit: 2, offset: 0, hasMore: false },
      workspacePagination: { total: 3, limit: 2, offset: 0, hasMore: true },
      historicalActorUsage: { usedDollars: 12.5, actorCount: 2 },
      workspaces: [
        { id: 'workspace-1', name: 'One' },
        { id: 'workspace-2', name: 'Two' },
      ],
    })
  })
})

describe('updateDashboardOrganizationLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveMetadataIntent.mockResolvedValue({
      latestRevision: 2,
      desiredMetadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 10,
        usageLimitCredits: 18_000,
      },
      desiredTerms: null,
      hasUnappliedIntent: false,
      effectiveSeatCapacity: 10,
      configurationUpdate: null,
    })
  })

  it('writes a configured Stripe base that materializes to the requested total after prepaid', async () => {
    queueTableRows(organization, [{ id: 'org-1', creditBalance: '10', orgUsageLimit: '100' }])
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        plan: 'enterprise',
        status: 'active',
        metadata: { usageLimitCredits: 18_000, seats: 10 },
      },
    ])

    await updateDashboardOrganizationLimits(
      'org-1',
      { usageLimitDollars: 50 },
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-enterprise-metadata',
      expect.objectContaining({
        subscriptionId: 'sub-1',
        metadata: expect.objectContaining({ usageLimitCredits: 8_000 }),
      })
    )
  })

  it('rejects a total limit below the prepaid balance', async () => {
    queueTableRows(organization, [{ id: 'org-1', creditBalance: '10', orgUsageLimit: '100' }])
    queueTableRows(subscription, [
      { id: 'sub-1', plan: 'enterprise', status: 'active', metadata: {} },
    ])

    await expect(
      updateDashboardOrganizationLimits(
        'org-1',
        { usageLimitDollars: 5 },
        { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
      )
    ).rejects.toThrow('cannot be below its prepaid balance')
    expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled()
  })
})

describe('updateDashboardEnterpriseBillingTerms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.resolveMetadataIntent.mockResolvedValue({
      latestRevision: 3,
      desiredMetadata: {
        plan: 'enterprise',
        referenceId: 'org-1',
        seats: 10,
        monthlyPrice: 125,
      },
      desiredTerms: null,
      hasUnappliedIntent: false,
      effectiveSeatCapacity: 10,
      configurationUpdate: null,
    })
  })

  it('queues a cadence and immutable Price change through the existing Stripe intent', async () => {
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        stripeSubscriptionId: 'stripe-sub-1',
        plan: 'enterprise',
        status: 'active',
        billingInterval: 'month',
        metadata: { plan: 'enterprise', referenceId: 'org-1', monthlyPrice: 125, seats: 10 },
      },
    ])

    await updateDashboardEnterpriseBillingTerms(
      'org-1',
      {
        invoiceAmountUsd: 1200,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2026-01-31',
      },
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(
      expect.anything(),
      'stripe.sync-enterprise-metadata',
      expect.objectContaining({
        revision: 4,
        terms: { invoiceAmountCents: 120_000, billingInterval: 'year' },
        metadata: expect.objectContaining({
          invoiceAmountCents: 120_000,
          reportingPeriodAnchorDate: '2026-01-31',
        }),
      })
    )
    expect(
      (mocks.enqueueOutboxEvent.mock.calls[0][2] as { metadata: Record<string, unknown> }).metadata
    ).toMatchObject({ monthlyPrice: null })
  })

  it('updates only metadata when the applied Price already matches', async () => {
    queueTableRows(subscription, [
      {
        id: 'sub-1',
        stripeSubscriptionId: 'stripe-sub-1',
        plan: 'enterprise',
        status: 'active',
        billingInterval: 'year',
        metadata: { invoiceAmountCents: 120_000, seats: 10 },
      },
    ])

    await updateDashboardEnterpriseBillingTerms(
      'org-1',
      {
        invoiceAmountUsd: 1200,
        billingInterval: 'year',
        reportingPeriodAnchorDate: '2025-01-31',
      },
      { id: 'admin-1', name: 'Admin', email: 'admin@sim.ai' }
    )

    expect(mocks.enqueueOutboxEvent.mock.calls[0][2]).not.toHaveProperty('terms')
  })
})
