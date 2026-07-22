/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')

const mocks = vi.hoisted(() => ({
  queryRows: [] as unknown[][],
  selectCalls: 0,
  selectDistinctOnCalls: 0,
  provisionings: new Map(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: {},
  AuditResourceType: {},
  recordAudit: vi.fn(),
}))
vi.mock('@sim/db', () => {
  function queryChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = () => chain
    }
    chain.offset = () => Promise.resolve(rows)
    chain.groupBy = () => Promise.resolve(rows)
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return chain
  }

  const db = {
    select: vi.fn(() => {
      const rows = mocks.queryRows[mocks.selectCalls] ?? []
      mocks.selectCalls += 1
      return queryChain(rows)
    }),
    selectDistinctOn: vi.fn(() => {
      const rows = mocks.queryRows[mocks.selectCalls] ?? []
      mocks.selectCalls += 1
      mocks.selectDistinctOnCalls += 1
      return queryChain(rows)
    }),
  }
  return { db }
})
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
    mocks.selectCalls = 0
    mocks.selectDistinctOnCalls = 0
    mocks.provisionings = new Map()
  })

  it('loads a page with a fixed batch of queries instead of querying once per organization', async () => {
    mocks.queryRows = [
      [{ total: 2 }],
      [
        { id: 'org-1', name: 'One', orgUsageLimit: '10', creditBalance: '1' },
        { id: 'org-2', name: 'Two', orgUsageLimit: '20', creditBalance: '2' },
      ],
      [
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
      ],
      [{ organizationId: 'org-1', externalCollaboratorCount: 3 }],
      [
        {
          id: 'sub-1',
          referenceId: 'org-1',
          plan: 'team_6000',
          status: 'active',
          metadata: null,
        },
      ],
    ]

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
    expect(mocks.selectCalls).toBe(5)
    expect(mocks.selectDistinctOnCalls).toBe(1)
  })
})
