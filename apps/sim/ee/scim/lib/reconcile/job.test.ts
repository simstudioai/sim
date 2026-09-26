import { scimConnection } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import {
  organizationMembershipMock,
  organizationMembershipMockFns,
} from '@sim/testing/mocks/organization-membership.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoistedMocks = vi.hoisted(() => ({
  isEntitled: vi.fn(),
  reconcileBatch: vi.fn(),
  listScimUserIds: vi.fn(),
  prune: vi.fn(),
  listGroups: vi.fn(),
  autoMap: vi.fn(),
  settleGroups: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => organizationMembershipMock)
vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/ee/scim/lib/projection/auto-map', () => ({
  autoMapPermissionGroupByName: hoistedMocks.autoMap,
  settleMappedPermissionGroupsExplicit: hoistedMocks.settleGroups,
}))
vi.mock('@/ee/scim/lib/repository/groups', () => ({
  listScimGroupsForReconcile: hoistedMocks.listGroups,
}))
vi.mock('@/ee/scim/lib/entitlement', () => ({
  isScimEntitledForOrganization: hoistedMocks.isEntitled,
}))
vi.mock('@/ee/scim/lib/projection/reconcile-user', () => ({
  PROJECTION_BATCH_SIZE: 25,
  reconcileUsersProjectionInBatches: hoistedMocks.reconcileBatch,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  listScimUserIds: hoistedMocks.listScimUserIds,
}))
vi.mock('@/ee/scim/lib/request-log', () => ({
  pruneScimRequestLog: hoistedMocks.prune,
}))

import { reconcileConnection, runScimReconcileSweep } from '@/ee/scim/lib/reconcile/job'

idMockFns.mockGenerateId.mockReturnValue('run-1')

const mocks = {
  ...hoistedMocks,
  acquireLock: organizationMembershipMockFns.mockAcquireOrganizationMutationLock,
}

const NOW = new Date('2026-03-01T12:00:00.000Z')
const LEASE_TTL_MS = 15 * 60 * 1000

const connection = { id: 'conn-1', organizationId: 'org-1', settings: { autoMap: true } }

const page = (ids: string[]) => ids.map((id) => ({ id, orderKey: `k-${id}` }))

const delta = (added = 0, raised = 0, removed = 0) => ({
  added: Array.from({ length: added }, (_, i) => ({ id: `a-${i}` })),
  raised: Array.from({ length: raised }, (_, i) => ({ id: `r-${i}` })),
  removed: Array.from({ length: removed }, (_, i) => ({ id: `x-${i}` })),
})

/** Grants the next compare-and-set lease claim. */
function grantLease() {
  dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'conn-1' }])
}

/** Queues the two connection reads one batch makes: the lease check, then the fresh settings. */
function stageBatch(token: string, settings?: Record<string, unknown>) {
  queueTableRows(scimConnection, [{ token }])
  queueTableRows(scimConnection, settings ? [{ settings }] : [])
}

const setCalls = () =>
  dbChainMockFns.set.mock.calls.map((call) => call[0] as Record<string, unknown>)

/** Flattens the nested and/or condition tree the mock operators build. */
function conditionNodes(condition: unknown): Array<Record<string, unknown>> {
  if (!condition || typeof condition !== 'object') return []
  const node = condition as Record<string, unknown>
  if ((node.type === 'and' || node.type === 'or') && Array.isArray(node.conditions)) {
    return node.conditions.flatMap(conditionNodes)
  }
  return [node]
}

afterAll(resetDbChainMock)

describe('reconcileConnection', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mocks.isEntitled.mockResolvedValue(true)
    mocks.prune.mockResolvedValue(undefined)
    mocks.reconcileBatch.mockResolvedValue(delta())
    mocks.listScimUserIds.mockResolvedValue([])
    mocks.listGroups.mockResolvedValue([])
    mocks.autoMap.mockResolvedValue('mapped')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing for an organization that is no longer entitled', async () => {
    mocks.isEntitled.mockResolvedValue(false)
    const report = await reconcileConnection(connection)
    expect(report).toBeNull()
    expect(mocks.isEntitled).toHaveBeenCalledWith('org-1')
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(mocks.prune).not.toHaveBeenCalled()
    expect(mocks.listScimUserIds).not.toHaveBeenCalled()
  })

  it('returns null without touching users when the lease claim is refused', async () => {
    const report = await reconcileConnection(connection)
    expect(report).toBeNull()
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(setCalls()[0]).toEqual({ reconcileLockToken: 'run-1', reconcileLeaseAt: NOW })
    expect(mocks.prune).not.toHaveBeenCalled()
    expect(mocks.listScimUserIds).not.toHaveBeenCalled()
    expect(mocks.reconcileBatch).not.toHaveBeenCalled()
  })

  it('claims a free lease or one older than its TTL in a single conditional update', async () => {
    grantLease()
    await reconcileConnection(connection)
    const nodes = conditionNodes(dbChainMockFns.where.mock.calls[0][0])
    expect(nodes).toContainEqual({ type: 'eq', left: scimConnection.id, right: 'conn-1' })
    expect(nodes).toContainEqual({ type: 'eq', left: scimConnection.status, right: 'active' })
    expect(nodes).toContainEqual({ type: 'isNull', column: scimConnection.reconcileLockToken })
    expect(nodes).toContainEqual({
      type: 'lt',
      left: scimConnection.reconcileLeaseAt,
      right: new Date(NOW.getTime() - LEASE_TTL_MS),
    })
    expect(dbChainMockFns.update).toHaveBeenCalledWith(scimConnection)
  })

  it('stops the pass and keeps the watermark when another run took the lease over', async () => {
    grantLease()
    mocks.listScimUserIds.mockResolvedValueOnce(page(['su-1', 'su-2']))
    stageBatch('run-2')
    const report = await reconcileConnection(connection)
    expect(report).toBeNull()
    expect(mocks.reconcileBatch).not.toHaveBeenCalled()
    const release = setCalls()[1]
    expect(release).toEqual({ reconcileLockToken: null, reconcileLeaseAt: null })
    expect(release).not.toHaveProperty('reconciledAt')
  })

  it('stops automatic matching when the rule was disabled after the pass was queued', async () => {
    grantLease()
    queueTableRows(scimConnection, [{ status: 'active', token: 'run-1', settings: {} }])
    await reconcileConnection({
      ...connection,
      settings: { autoMapPermissionGroupsByName: true },
    })
    expect(mocks.listGroups).not.toHaveBeenCalled()
    expect(mocks.autoMap).not.toHaveBeenCalled()
  })

  it('stamps reconciledAt only after a completed pass', async () => {
    grantLease()
    const report = await reconcileConnection(connection)
    expect(report).toEqual({
      connectionId: 'conn-1',
      reconciledUsers: 0,
      grantsAdded: 0,
      grantsRemoved: 0,
    })
    expect(setCalls()[1]).toEqual({
      reconcileLockToken: null,
      reconcileLeaseAt: null,
      reconciledAt: NOW,
    })
    const releaseNodes = conditionNodes(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(releaseNodes).toContainEqual({
      type: 'eq',
      left: scimConnection.reconcileLockToken,
      right: 'run-1',
    })
  })

  it('prunes the request log before the pass and releases the lease when a batch throws', async () => {
    grantLease()
    mocks.listScimUserIds.mockResolvedValueOnce(page(['su-1']))
    stageBatch('run-1', {})
    mocks.reconcileBatch.mockRejectedValueOnce(new Error('projection failed'))

    await expect(reconcileConnection(connection)).rejects.toThrow('projection failed')

    expect(mocks.prune).toHaveBeenCalledWith('conn-1')
    expect(mocks.prune.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listScimUserIds.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.update).toHaveBeenCalledTimes(2)
    const release = setCalls()[1]
    expect(release).toEqual({ reconcileLockToken: null, reconcileLeaseAt: null })
    expect(release).not.toHaveProperty('reconciledAt')
  })
})

describe('runScimReconcileSweep', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mocks.isEntitled.mockResolvedValue(true)
    mocks.prune.mockResolvedValue(undefined)
    mocks.reconcileBatch.mockResolvedValue(delta())
    mocks.listScimUserIds.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('totals the completed passes and keeps going past a connection that fails', async () => {
    queueTableRows(scimConnection, [
      { id: 'conn-1', organizationId: 'org-1', settings: {} },
      { id: 'conn-2', organizationId: 'org-2', settings: {} },
      { id: 'conn-3', organizationId: 'org-3', settings: {} },
    ])

    grantLease()
    mocks.listScimUserIds.mockResolvedValueOnce(page(['su-1', 'su-2'])).mockResolvedValueOnce([])
    stageBatch('run-1', {})
    mocks.reconcileBatch.mockResolvedValueOnce(delta(1, 0, 0))

    grantLease()
    mocks.prune.mockRejectedValueOnce(new Error('tenant down'))

    mocks.isEntitled
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const sweep = await runScimReconcileSweep(10)

    expect(dbChainMockFns.limit).toHaveBeenCalledWith(10)
    expect(sweep).toEqual({ connections: 1, reconciledUsers: 2, grantsAdded: 1, grantsRemoved: 0 })
    expect(mocks.isEntitled.mock.calls.map((call) => call[0])).toEqual(['org-1', 'org-2', 'org-3'])
    expect(mocks.prune).toHaveBeenCalledTimes(2)
  })
})
