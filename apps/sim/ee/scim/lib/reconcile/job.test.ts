/**
 * @vitest-environment node
 */
import { db } from '@sim/db'
import { scimConnection } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEntitled: vi.fn(),
  reconcileBatch: vi.fn(),
  listScimUserIds: vi.fn(),
  prune: vi.fn(),
  acquireLock: vi.fn(),
  listGroups: vi.fn(),
  autoMap: vi.fn(),
  settleGroups: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/membership', () => ({
  acquireOrganizationMutationLock: mocks.acquireLock,
}))
vi.mock('@/ee/scim/lib/projection/auto-map', () => ({
  autoMapPermissionGroupByName: mocks.autoMap,
  settleMappedPermissionGroupsExplicit: mocks.settleGroups,
}))
vi.mock('@/ee/scim/lib/repository/groups', () => ({
  listScimGroupsForReconcile: mocks.listGroups,
}))
vi.mock('@sim/utils/id', () => ({ generateId: () => 'run-1' }))
vi.mock('@/ee/scim/lib/entitlement', () => ({
  isScimEntitledForOrganization: mocks.isEntitled,
}))
vi.mock('@/ee/scim/lib/projection/reconcile-user', () => ({
  PROJECTION_BATCH_SIZE: 25,
  reconcileUsersProjectionInBatches: mocks.reconcileBatch,
}))
vi.mock('@/ee/scim/lib/repository/users', () => ({
  listScimUserIds: mocks.listScimUserIds,
}))
vi.mock('@/ee/scim/lib/request-log', () => ({
  pruneScimRequestLog: mocks.prune,
}))

import { reconcileConnection, runScimReconcileSweep } from '@/ee/scim/lib/reconcile/job'

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
    vi.clearAllMocks()
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

  it('re-reads the settings for every batch and pages by the last order key', async () => {
    grantLease()
    const first = page(Array.from({ length: 25 }, (_, i) => `su-${i}`))
    const second = page(['su-25', 'su-26', 'su-27'])
    mocks.listScimUserIds
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce([])
    stageBatch('run-1', { autoMap: false })
    stageBatch('run-1', { autoMap: true, defaultRole: 'admin' })

    await reconcileConnection(connection)

    expect(mocks.listScimUserIds).toHaveBeenNthCalledWith(1, db, {
      connectionId: 'conn-1',
      limit: 25,
    })
    expect(mocks.listScimUserIds).toHaveBeenNthCalledWith(2, db, {
      connectionId: 'conn-1',
      afterOrderKey: 'k-su-24',
      limit: 25,
    })
    expect(mocks.listScimUserIds).toHaveBeenNthCalledWith(3, db, {
      connectionId: 'conn-1',
      afterOrderKey: 'k-su-27',
      limit: 25,
    })
    expect(mocks.reconcileBatch).toHaveBeenCalledTimes(2)
    expect(mocks.reconcileBatch).toHaveBeenNthCalledWith(1, {
      connectionId: 'conn-1',
      organizationId: 'org-1',
      scimUserIds: first.map((row) => row.id),
      settings: { autoMap: false },
    })
    expect(mocks.reconcileBatch).toHaveBeenNthCalledWith(2, {
      connectionId: 'conn-1',
      organizationId: 'org-1',
      scimUserIds: ['su-25', 'su-26', 'su-27'],
      settings: { autoMap: true, defaultRole: 'admin' },
    })
  })

  it('matches pre-existing groups before projecting users when automatic matching is enabled', async () => {
    grantLease()
    const settings = { autoMapPermissionGroupsByName: true }
    const groups = [{ id: 'group-1', displayName: 'Engineering', orderKey: 'group-key-1' }]
    mocks.listGroups.mockResolvedValueOnce(groups).mockResolvedValueOnce([])
    queueTableRows(scimConnection, [{ status: 'active', token: 'run-1', settings }])
    queueTableRows(scimConnection, [{ status: 'active', token: 'run-1', settings }])
    mocks.listScimUserIds.mockResolvedValueOnce(page(['su-1'])).mockResolvedValueOnce([])
    stageBatch('run-1', settings)

    await reconcileConnection({ ...connection, settings })

    expect(mocks.autoMap).toHaveBeenCalledWith(db, {
      organizationId: 'org-1',
      scimGroupId: 'group-1',
      displayName: 'Engineering',
    })
    expect(mocks.listGroups).toHaveBeenNthCalledWith(2, db, {
      connectionId: 'conn-1',
      afterOrderKey: 'group-key-1',
      limit: 25,
    })
    expect(mocks.settleGroups).toHaveBeenCalledWith(db, {
      organizationId: 'org-1',
      scimGroupId: 'group-1',
    })
    expect(mocks.autoMap.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcileBatch.mock.invocationCallOrder[0]
    )
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

  it('falls back to the settings the due query returned when the row cannot be re-read', async () => {
    grantLease()
    mocks.listScimUserIds.mockResolvedValueOnce(page(['su-1'])).mockResolvedValueOnce([])
    stageBatch('run-1')
    await reconcileConnection(connection)
    expect(mocks.reconcileBatch).toHaveBeenCalledWith(
      expect.objectContaining({ settings: { autoMap: true } })
    )
  })

  it('reports users reconciled and counts raised grants as additions', async () => {
    grantLease()
    mocks.listScimUserIds
      .mockResolvedValueOnce(page(['su-1', 'su-2']))
      .mockResolvedValueOnce(page(['su-3']))
      .mockResolvedValueOnce([])
    stageBatch('run-1', {})
    stageBatch('run-1', {})
    mocks.reconcileBatch.mockResolvedValueOnce(delta(2, 1, 1)).mockResolvedValueOnce(delta(0, 0, 2))

    const report = await reconcileConnection(connection)

    expect(report).toEqual({
      connectionId: 'conn-1',
      reconciledUsers: 3,
      grantsAdded: 3,
      grantsRemoved: 3,
    })
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

  it('still releases the lease when the prune itself throws', async () => {
    grantLease()
    mocks.prune.mockRejectedValueOnce(new Error('prune failed'))
    await expect(reconcileConnection(connection)).rejects.toThrow('prune failed')
    expect(mocks.listScimUserIds).not.toHaveBeenCalled()
    expect(setCalls()[1]).toEqual({ reconcileLockToken: null, reconcileLeaseAt: null })
  })
})

describe('runScimReconcileSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns an empty sweep when nothing is due', async () => {
    const sweep = await runScimReconcileSweep()
    expect(sweep).toEqual({ connections: 0, reconciledUsers: 0, grantsAdded: 0, grantsRemoved: 0 })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(200)
    expect(mocks.isEntitled).not.toHaveBeenCalled()
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
