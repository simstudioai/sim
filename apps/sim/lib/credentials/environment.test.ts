/**
 * @vitest-environment node
 */
import { credential, permissions, workspace } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

const { mockAcquireUserBillingIdentityLock } = vi.hoisted(() => ({
  mockAcquireUserBillingIdentityLock: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mockAcquireUserBillingIdentityLock,
}))

import {
  getWorkspaceEnvKeyAdminAccess,
  syncPersonalEnvCredentialsForUser,
} from '@/lib/credentials/environment'

describe('getWorkspaceEnvKeyAdminAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns empty sets without querying when no keys are provided', async () => {
    const result = await getWorkspaceEnvKeyAdminAccess({
      workspaceId: 'ws-1',
      envKeys: [],
      userId: 'u-1',
    })

    expect(result.adminKeys.size).toBe(0)
    expect(result.knownKeys.size).toBe(0)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('marks a key admin only for an active admin membership, known for any credential', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([
      { envKey: 'OWNED', role: 'admin', status: 'active' },
      { envKey: 'MEMBER_ONLY', role: 'member', status: 'active' },
      { envKey: 'PENDING_ADMIN', role: 'admin', status: 'pending' },
      { envKey: 'NO_MEMBERSHIP', role: null, status: null },
    ])

    const result = await getWorkspaceEnvKeyAdminAccess({
      workspaceId: 'ws-1',
      envKeys: ['OWNED', 'MEMBER_ONLY', 'PENDING_ADMIN', 'NO_MEMBERSHIP', 'ABSENT'],
      userId: 'u-1',
    })

    expect([...result.adminKeys]).toEqual(['OWNED'])
    expect([...result.knownKeys].sort()).toEqual([
      'MEMBER_ONLY',
      'NO_MEMBERSHIP',
      'OWNED',
      'PENDING_ADMIN',
    ])
    expect(result.knownKeys.has('ABSENT')).toBe(false)
  })

  it('dedupes and drops empty keys before issuing a single query', async () => {
    dbChainMockFns.where.mockResolvedValueOnce([])

    await getWorkspaceEnvKeyAdminAccess({
      workspaceId: 'ws-1',
      envKeys: ['A', 'A', '', 'B'],
      userId: 'u-1',
    })

    expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
  })
})

describe('syncPersonalEnvCredentialsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockAcquireUserBillingIdentityLock.mockResolvedValue(undefined)
  })

  it('uses one transaction and acquires the transfer fence before discovering workspaces', async () => {
    const base = dbChainMock.db
    const tx = {
      select: vi.fn(base.select),
      insert: vi.fn(base.insert),
      delete: vi.fn(base.delete),
    } as unknown as DbOrTx
    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => callback(tx))
    queueTableRows(permissions, [{ workspaceId: 'ws-1' }])
    queueTableRows(workspace, [])
    queueTableRows(credential, [{ id: 'credential-1' }])

    await syncPersonalEnvCredentialsForUser({
      userId: 'user-1',
      envKeys: ['API_KEY'],
    })

    expect(mockAcquireUserBillingIdentityLock).toHaveBeenCalledWith(tx, 'user-1')
    expect(mockAcquireUserBillingIdentityLock.mock.invocationCallOrder[0]).toBeLessThan(
      (tx.select as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    )
    expect(tx.select).toHaveBeenCalledTimes(3)
    expect(tx.insert).toHaveBeenCalledTimes(2)
    expect(tx.delete).toHaveBeenCalledTimes(1)
  })

  it('does not recreate source credentials when transfer won the user lock', async () => {
    const base = dbChainMock.db
    const tx = {
      select: vi.fn(base.select),
      insert: vi.fn(base.insert),
      delete: vi.fn(base.delete),
    } as unknown as DbOrTx
    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => callback(tx))
    queueTableRows(permissions, [])
    queueTableRows(workspace, [])

    await syncPersonalEnvCredentialsForUser({
      userId: 'user-1',
      envKeys: ['API_KEY'],
    })

    expect(mockAcquireUserBillingIdentityLock.mock.invocationCallOrder[0]).toBeLessThan(
      (tx.select as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    )
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.delete).not.toHaveBeenCalled()
  })

  it('syncs every workspace with one credential insert, lookup, membership insert, and cleanup', async () => {
    const base = dbChainMock.db
    const tx = {
      select: vi.fn(base.select),
      insert: vi.fn(base.insert),
      delete: vi.fn(base.delete),
    } as unknown as DbOrTx
    dbChainMockFns.transaction.mockImplementationOnce(async (callback) => callback(tx))
    queueTableRows(permissions, [{ workspaceId: 'ws-2' }, { workspaceId: 'ws-1' }])
    queueTableRows(workspace, [])
    queueTableRows(credential, [{ id: 'credential-1' }, { id: 'credential-2' }])

    await syncPersonalEnvCredentialsForUser({
      userId: 'user-1',
      envKeys: ['API_KEY'],
    })

    expect(tx.select).toHaveBeenCalledTimes(3)
    expect(tx.insert).toHaveBeenCalledTimes(2)
    expect(tx.delete).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ workspaceId: 'ws-1', envKey: 'API_KEY' }),
      expect.objectContaining({ workspaceId: 'ws-2', envKey: 'API_KEY' }),
    ])
  })
})
