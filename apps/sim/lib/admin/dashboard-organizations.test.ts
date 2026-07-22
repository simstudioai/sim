/** @vitest-environment node */

import { member, organization, permissions, subscription } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const mocks = vi.hoisted(() => ({
  provisionings: new Map(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))
vi.mock('@sim/db', () => dbChainMock)
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
  resolveEnterpriseMetadataIntent: vi.fn(),
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
vi.mock('@/lib/core/idempotency/transaction', () => ({
  executeTransactionallyIdempotent: vi.fn(),
}))
vi.mock('@/lib/core/outbox/service', () => ({ enqueueOutboxEvent: vi.fn() }))

import { listDashboardOrganizations, toDashboardConfigurationUpdate } from '@/lib/admin/dashboard'

afterAll(() => {
  resetDbChainMock()
})

describe('toDashboardConfigurationUpdate', () => {
  it('converts the pending Stripe metadata intent without replacing applied values', () => {
    expect(
      toDashboardConfigurationUpdate({
        latestRevision: 2,
        desiredMetadata: {},
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
          error: null,
        },
      })
    ).toEqual({
      id: 'config-2',
      status: 'pending',
      requestedUsageLimitDollars: 50_000,
      requestedSeats: 20,
      requestedConcurrencyLimit: 50,
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
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(4)
    expect(dbChainMockFns.selectDistinctOn).toHaveBeenCalledTimes(1)
  })
})
