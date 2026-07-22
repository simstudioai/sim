/** @vitest-environment node */

import { databaseMock, dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import type { Mock } from 'vitest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

/**
 * `@sim/db` behavior is driven through the SHARED `dbChainMockFns` instances
 * instead of a file-local factory object. This file mocks `@sim/db` with
 * `dbChainMock` and installs the queued-rows select implementation in
 * `beforeEach`; the setup-level `databaseMock` entry points are mirrored onto
 * the same chain fns. Under `isolate: false` the module under test may have
 * been loaded by an earlier suite in this worker with `@sim/db` bound to
 * `databaseMock` — configuring both shared instances keeps either binding
 * correct.
 */
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

function queuedSelect() {
  const rows = mocks.queryRows[mocks.selectCalls] ?? []
  mocks.selectCalls += 1
  return queryChain(rows)
}

function queuedSelectDistinctOn() {
  const rows = mocks.queryRows[mocks.selectCalls] ?? []
  mocks.selectCalls += 1
  mocks.selectDistinctOnCalls += 1
  return queryChain(rows)
}

const GLOBAL_DB_KEYS = [
  'select',
  'selectDistinct',
  'insert',
  'update',
  'delete',
  'transaction',
] as const

const globalDb = databaseMock.db as unknown as Record<(typeof GLOBAL_DB_KEYS)[number], Mock>
const savedGlobalDbImpls = new Map<
  (typeof GLOBAL_DB_KEYS)[number],
  ((...args: unknown[]) => unknown) | undefined
>()

/** Mirrors the setup-level databaseMock entry points onto the shared chain fns. */
function delegateGlobalDbToChainMocks(): void {
  for (const key of GLOBAL_DB_KEYS) {
    const fn = globalDb[key]
    if (typeof fn?.mockImplementation !== 'function') continue
    if (!savedGlobalDbImpls.has(key)) savedGlobalDbImpls.set(key, fn.getMockImplementation())
    fn.mockImplementation((...args: unknown[]) => (dbChainMockFns[key] as Mock)(...args))
  }
}

/** Restores the databaseMock entry points captured before this suite ran. */
function restoreGlobalDb(): void {
  for (const [key, impl] of savedGlobalDbImpls) {
    if (impl) globalDb[key].mockImplementation(impl)
  }
}

afterAll(() => {
  resetDbChainMock()
  restoreGlobalDb()
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
    dbChainMockFns.select.mockImplementation(queuedSelect)
    dbChainMockFns.selectDistinctOn.mockImplementation(queuedSelectDistinctOn)
    delegateGlobalDbToChainMocks()
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
