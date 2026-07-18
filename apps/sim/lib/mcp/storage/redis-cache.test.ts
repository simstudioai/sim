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
  }
  const cache = new RedisMcpCache(redis as unknown as Redis)

  beforeEach(() => {
    vi.clearAllMocks()
    multi.incr.mockReturnValue(multi)
    multi.pexpire.mockReturnValue(multi)
    multi.exec.mockResolvedValue([
      [null, 7],
      [null, 1],
    ])
  })

  it('allocates a shared per-server mutation id with an expiry', async () => {
    await expect(cache.beginMutation('workspace:w:server:s')).resolves.toBe(7)

    expect(multi.incr).toHaveBeenCalledWith('mcp:tools-mutation:workspace:w:server:s')
    expect(multi.pexpire).toHaveBeenCalledWith(
      'mcp:tools-mutation:workspace:w:server:s',
      24 * 60 * 60 * 1000
    )
  })

  it('reports whether a tool cache write still owns the current mutation', async () => {
    redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    await expect(
      cache.setIfCurrentMutation('workspace:w:server:s', 7, 'workspace:w:server:s', [tool], 60_000)
    ).resolves.toBe(true)
    await expect(
      cache.setIfCurrentMutation(
        'workspace:w:server:s',
        6,
        'workspace:w:server:s:failure',
        [],
        60_000
      )
    ).resolves.toBe(false)

    expect(redis.eval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("redis.call('SET'"),
      2,
      'mcp:tools-mutation:workspace:w:server:s',
      'mcp:tools:workspace:w:server:s',
      '7',
      expect.stringContaining('new-tool'),
      '60000'
    )
  })

  it('guards cache deletion with the same mutation id', async () => {
    redis.eval.mockResolvedValueOnce(0)

    await expect(
      cache.deleteIfCurrentMutation('workspace:w:server:s', 6, 'workspace:w:server:s:failure')
    ).resolves.toBe(false)

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      2,
      'mcp:tools-mutation:workspace:w:server:s',
      'mcp:tools:workspace:w:server:s:failure',
      '6'
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
})
