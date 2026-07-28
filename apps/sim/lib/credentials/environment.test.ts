/**
 * @vitest-environment node
 */
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkspaceEnvKeyAdminAccess } from '@/lib/credentials/environment'

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
