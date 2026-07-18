/**
 * @vitest-environment node
 */
import type Redis from 'ioredis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RedisMcpCache } from '@/lib/mcp/storage/redis-cache'
import type { McpTool } from '@/lib/mcp/types'

const tool: McpTool = {
  name: 'new-tool',
  description: 'New tool',
  inputSchema: { type: 'object' },
  serverId: 'server-1',
  serverName: 'Server 1',
}

describe('RedisMcpCache ordered mutations', () => {
  const multi = {
    incr: vi.fn(),
    pexpire: vi.fn(),
    exec: vi.fn(),
  }
  const redis = {
    multi: vi.fn(() => multi),
    eval: vi.fn(),
    scan: vi.fn(),
    del: vi.fn(),
  }
  const cache = new RedisMcpCache(redis as unknown as Redis)

  beforeEach(() => {
    vi.clearAllMocks()
    redis.eval.mockReset()
    redis.scan.mockReset()
    redis.del.mockReset()
    multi.incr.mockReturnValue(multi)
    multi.pexpire.mockReturnValue(multi)
    multi.exec.mockResolvedValue([
      [null, 7],
      [null, 1],
    ])
  })

  it('allocates a timestamp-based per-server mutation id with an expiry', async () => {
    const mutationId = 1_900_000_000_000
    redis.eval.mockResolvedValueOnce(mutationId)

    await expect(cache.beginMutation('workspace:w:server:s')).resolves.toBe(mutationId)

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringMatching(/redis\.call\('TIME'\).*math\.max/s),
      1,
      'mcp:tools-mutation:workspace:w:server:s',
      String(24 * 60 * 60 * 1000)
    )
  })

  it('atomically replaces the complete cache state for the current mutation', async () => {
    redis.eval.mockResolvedValueOnce(1)

    await expect(
      cache.applyMutationIfCurrent(
        'workspace:w:server:s',
        7,
        {
          key: 'workspace:w:server:s',
          tools: [tool],
          ttlMs: 60_000,
        },
        ['workspace:w:server:s:failure']
      )
    ).resolves.toBe(true)

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringMatching(/redis\.call\('SET'.*redis\.call\('DEL'/s),
      3,
      'mcp:tools-mutation:workspace:w:server:s',
      'mcp:tools:workspace:w:server:s',
      'mcp:tools:workspace:w:server:s:failure',
      '7',
      '1',
      expect.stringContaining('new-tool'),
      '60000'
    )
  })

  it('invalidates mutation owners before deleting entries during a full clear', async () => {
    redis.scan
      .mockResolvedValueOnce(['0', ['mcp:tools-mutation:workspace:w:server:s']])
      .mockResolvedValueOnce([
        '0',
        ['mcp:tools:workspace:w:server:s', 'mcp:tools:workspace:w:server:s:failure'],
      ])
    redis.del.mockResolvedValueOnce(2)

    await cache.clear()

    expect(multi.incr).toHaveBeenCalledWith('mcp:tools-mutation:workspace:w:server:s')
    expect(redis.del).toHaveBeenCalledWith(
      'mcp:tools:workspace:w:server:s',
      'mcp:tools:workspace:w:server:s:failure'
    )
    expect(multi.exec.mock.invocationCallOrder[0]).toBeLessThan(
      redis.del.mock.invocationCallOrder[0]
    )
  })
})
