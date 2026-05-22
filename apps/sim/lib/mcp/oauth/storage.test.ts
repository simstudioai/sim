/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  encryptionMock,
  encryptionMockFns,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAcquireLock, mockReleaseLock, mockExtendLock } = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockExtendLock: vi.fn(),
}))

vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/core/config/redis', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock,
  extendLock: mockExtendLock,
}))

import {
  getOrCreateOauthRow,
  loadOauthRow,
  setOauthRowUser,
  withMcpOauthRefreshLock,
} from './storage'

describe('MCP OAuth storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: '{}' })
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({
      encrypted: 'encrypted',
      iv: 'iv',
    })
  })

  it('loads OAuth state by MCP server, independent of the requesting user', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'oauth-row-1',
        mcpServerId: 'server-1',
        userId: 'authorizer-1',
        workspaceId: 'workspace-1',
        clientInformation: null,
        tokens: null,
        codeVerifier: null,
        state: null,
        updatedAt: new Date(),
      },
    ])

    const row = await loadOauthRow({ mcpServerId: 'server-1' })

    expect(row).toMatchObject({
      id: 'oauth-row-1',
      mcpServerId: 'server-1',
      userId: 'authorizer-1',
      workspaceId: 'workspace-1',
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledTimes(1)
  })

  it('reuses the existing workspace OAuth row instead of creating a per-user row', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        id: 'oauth-row-1',
        mcpServerId: 'server-1',
        userId: 'authorizer-1',
        workspaceId: 'workspace-1',
        clientInformation: null,
        tokens: null,
        codeVerifier: null,
        state: null,
        updatedAt: new Date(),
      },
    ])

    const row = await getOrCreateOauthRow({
      mcpServerId: 'server-1',
      userId: 'different-user',
      workspaceId: 'workspace-1',
    })

    expect(row.id).toBe('oauth-row-1')
    expect(row.userId).toBe('authorizer-1')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('records the latest authorizing user without changing row ownership', async () => {
    await setOauthRowUser('oauth-row-1', 'user-2')

    expect(dbChainMockFns.update).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        updatedAt: expect.any(Date),
      })
    )
  })
})

describe('withMcpOauthRefreshLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAcquireLock.mockReset()
    mockReleaseLock.mockReset()
    mockExtendLock.mockReset()
    mockReleaseLock.mockResolvedValue(true)
    mockExtendLock.mockResolvedValue(true)
  })

  it('serializes concurrent in-process callers, each running its own fn()', async () => {
    mockAcquireLock.mockResolvedValue(true)
    let active = 0
    let maxActive = 0
    const fn = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
      return 'tokens'
    })

    const results = await Promise.all([
      withMcpOauthRefreshLock('row-serial', fn),
      withMcpOauthRefreshLock('row-serial', fn),
      withMcpOauthRefreshLock('row-serial', fn),
    ])

    expect(results).toEqual(['tokens', 'tokens', 'tokens'])
    // Each caller gets its own fn() invocation — critical because fn() returns
    // a stateful McpClient that can't be shared across consumers.
    expect(fn).toHaveBeenCalledTimes(3)
    // But never two at the same time within a process.
    expect(maxActive).toBe(1)
    expect(mockAcquireLock).toHaveBeenCalledTimes(3)
    expect(mockReleaseLock).toHaveBeenCalledTimes(3)
  })

  it('serializes cross-process callers: follower polls until leader releases', async () => {
    // First acquire fails (another process holds it), second succeeds.
    mockAcquireLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const fn = vi.fn(async () => 'fresh')

    const result = await withMcpOauthRefreshLock('row-mutex', fn)

    expect(result).toBe('fresh')
    expect(mockAcquireLock).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('falls open when Redis is unavailable on acquire', async () => {
    mockAcquireLock.mockRejectedValueOnce(new Error('Redis connection refused'))
    const fn = vi.fn(async () => 'uncoordinated')

    const result = await withMcpOauthRefreshLock('row-redis-down', fn)

    expect(result).toBe('uncoordinated')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(mockReleaseLock).not.toHaveBeenCalled()
  })

  it('releases the lock even when fn throws', async () => {
    mockAcquireLock.mockResolvedValue(true)
    const fn = vi.fn(async () => {
      throw new Error('refresh failed')
    })

    await expect(withMcpOauthRefreshLock('row-throws', fn)).rejects.toThrow('refresh failed')

    expect(mockReleaseLock).toHaveBeenCalledTimes(1)
  })

  it('does not surface releaseLock failures to the caller', async () => {
    mockAcquireLock.mockResolvedValue(true)
    mockReleaseLock.mockRejectedValueOnce(new Error('release failed'))
    const fn = vi.fn(async () => 'value')

    const result = await withMcpOauthRefreshLock('row-release-fail', fn)
    expect(result).toBe('value')
  })

  it('uses per-row lock keys so different rows do not serialize', async () => {
    mockAcquireLock.mockResolvedValue(true)
    const fn = vi.fn(async () => 'ok')

    await Promise.all([withMcpOauthRefreshLock('row-a', fn), withMcpOauthRefreshLock('row-b', fn)])

    expect(mockAcquireLock).toHaveBeenCalledTimes(2)
    const keys = mockAcquireLock.mock.calls.map((c) => c[0])
    expect(keys).toContain('mcp:oauth:refresh:row-a')
    expect(keys).toContain('mcp:oauth:refresh:row-b')
  })

  it('throws when the lock is held longer than the max wait (does not race)', async () => {
    vi.useFakeTimers()
    try {
      // Acquire always fails — another process holds the lock with watchdog extension.
      mockAcquireLock.mockResolvedValue(false)
      const fn = vi.fn(async () => 'should-not-run')

      const pending = withMcpOauthRefreshLock('row-deadline', fn)
      // Attach the rejection expectation before draining so Vitest doesn't see
      // an unhandled rejection while timers advance.
      const assertion = expect(pending).rejects.toThrow(/held longer than/)
      await vi.advanceTimersByTimeAsync(31_000)
      await assertion
      expect(fn).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('extends the lock TTL while fn() is running so long refreshes do not lose the lock', async () => {
    vi.useFakeTimers()
    try {
      mockAcquireLock.mockResolvedValue(true)
      let resolveFn: (v: string) => void
      const fn = vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveFn = resolve
          })
      )

      const pending = withMcpOauthRefreshLock('row-watchdog', fn)

      // Advance time past two extend intervals (5s + 5s = 10s).
      await vi.advanceTimersByTimeAsync(11_000)
      expect(mockExtendLock.mock.calls.length).toBeGreaterThanOrEqual(2)
      for (const call of mockExtendLock.mock.calls) {
        expect(call[0]).toBe('mcp:oauth:refresh:row-watchdog')
      }

      resolveFn!('done')
      await expect(pending).resolves.toBe('done')

      // Watchdog must stop once fn() settles — no more extend calls.
      const extendCallsAtFinish = mockExtendLock.mock.calls.length
      await vi.advanceTimersByTimeAsync(20_000)
      expect(mockExtendLock.mock.calls.length).toBe(extendCallsAtFinish)
    } finally {
      vi.useRealTimers()
    }
  })
})
