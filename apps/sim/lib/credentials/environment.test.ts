/**
 * @vitest-environment node
 */
import { credential, permissions, workspace } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

const { mockAcquireUserBillingIdentityLock } = vi.hoisted(() => ({
  mockAcquireUserBillingIdentityLock: vi.fn(),
}))

vi.mock('@/lib/billing/organizations/billing-identity-lock', () => ({
  acquireUserBillingIdentityLock: mockAcquireUserBillingIdentityLock,
}))

import {
  createWorkspaceEnvCredentials,
  getEnrolledManagedOAuthCredentials,
  getPersonalEnvKeyRawAccess,
  getWorkspaceEnvKeyAdminAccess,
  syncPersonalEnvCredentialsForUser,
} from '@/lib/credentials/environment'

describe('managed OAuth credential lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it.each(['active', 'revoked'] as const)(
    'bounds lookup and preserves %s binding checks',
    async (status) => {
      queueTableRows(credential, [
        {
          id: 'mine',
          providerId: 'slack',
          displayName: 'Slack',
          credentialGroupOptionId: 'option',
          managedOauthStatus: status,
          enrollmentStatus: 'completed',
          groupName: 'Connected accounts',
          groupStatus: 'active',
          groupOptions: [{ id: 'option', status: 'active' }],
        },
      ])
      const result = await getEnrolledManagedOAuthCredentials('workspace', 'person', 'mine')
      expect(eq).toHaveBeenCalledWith(credential.id, 'mine')
      expect(eq).toHaveBeenCalledWith(credential.workspaceId, 'workspace')
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
      expect(result).toHaveLength(status === 'active' ? 1 : 0)
    }
  )
})

describe('getPersonalEnvKeyRawAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns own values without querying credential grants', async () => {
    const result = await getPersonalEnvKeyRawAccess({
      workspaceId: 'ws-1',
      userId: 'u-1',
      personalOwners: { OWN_KEY: 'u-1' },
    })

    expect([...result.ownedKeys]).toEqual(['OWN_KEY'])
    expect(result.adminKeys.size).toBe(0)
    expect(dbChainMockFns.where).not.toHaveBeenCalled()
  })

  it('allows own values and only active admin grants for other personal values', async () => {
    queueTableRows(credential, [
      {
        envKey: 'SHARED_ADMIN',
        envOwnerUserId: 'owner-2',
        role: 'admin',
        status: 'active',
      },
      {
        envKey: 'SHARED_MEMBER',
        envOwnerUserId: 'owner-3',
        role: 'member',
        status: 'active',
      },
      {
        envKey: 'REVOKED_ADMIN',
        envOwnerUserId: 'owner-4',
        role: 'admin',
        status: 'revoked',
      },
    ])

    const result = await getPersonalEnvKeyRawAccess({
      workspaceId: 'ws-1',
      userId: 'u-1',
      personalOwners: {
        OWN_KEY: 'u-1',
        SHARED_ADMIN: 'owner-2',
        SHARED_MEMBER: 'owner-3',
        REVOKED_ADMIN: 'owner-4',
      },
    })

    expect([...result.ownedKeys]).toEqual(['OWN_KEY'])
    expect([...result.adminKeys]).toEqual(['SHARED_ADMIN'])
  })

  it('requires the admin grant to belong to the exact effective secret owner', async () => {
    queueTableRows(credential, [
      {
        envKey: 'COLLISION',
        envOwnerUserId: 'owner-a',
        role: 'admin',
        status: 'active',
      },
      {
        envKey: 'COLLISION',
        envOwnerUserId: 'owner-b',
        role: 'member',
        status: 'active',
      },
    ])

    const result = await getPersonalEnvKeyRawAccess({
      workspaceId: 'ws-1',
      userId: 'u-1',
      personalOwners: { COLLISION: 'owner-b' },
    })

    expect(result.ownedKeys.size).toBe(0)
    expect(result.adminKeys.size).toBe(0)
  })
})

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

describe('createWorkspaceEnvCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  /**
   * The membership row count is keys × members, and neither is bounded by the
   * request contract. A single statement past Postgres's 65535 bind parameters
   * throws — and because this now runs inside the value's transaction, that
   * would roll back the save on every retry rather than half-committing it.
   */
  it('splits a keys x members write too wide for one statement', async () => {
    const keys = Array.from({ length: 40 }, (_, i) => `KEY_${i}`)
    queueTableRows(workspace, [{ ownerId: 'owner-1' }])
    queueTableRows(
      permissions,
      Array.from({ length: 60 }, (_, i) => ({ userId: `member-${i}` }))
    )
    // Every chunk of the credential insert reports its rows back as created.
    dbChainMockFns.returning.mockImplementation(() =>
      Promise.resolve(keys.map((_, i) => ({ id: `credential-${i}` })))
    )

    await createWorkspaceEnvCredentials({
      workspaceId: 'ws-1',
      newKeys: keys,
      actingUserId: 'member-0',
    })

    const rowsPerCall = dbChainMockFns.values.mock.calls.map(([rows]) =>
      Array.isArray(rows) ? rows.length : 1
    )
    expect(rowsPerCall.length).toBeGreaterThan(1)
    expect(Math.max(...rowsPerCall)).toBeLessThanOrEqual(500)
  })
})
