/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  call: vi.fn(),
}))

vi.mock('ioredis', () => ({
  default: class Redis {
    constructor(config: Record<string, unknown>) {
      redisMocks.configs.push(config)
    }

    call = redisMocks.call
  },
}))

import { createRedisClient, executeRedisClientCommand } from '@/lib/internal/redis/client'

describe('Redis client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMocks.configs.length = 0
  })

  it('preserves the connection timeout, command timeout, and retry policy', () => {
    createRedisClient({
      host: '203.0.113.10',
      port: 6380,
      username: 'user',
      password: 'password',
      db: 2,
      family: 4,
      tlsServername: 'cache.example.com',
    })

    expect(redisMocks.configs).toEqual([
      {
        host: '203.0.113.10',
        port: 6380,
        username: 'user',
        password: 'password',
        db: 2,
        family: 4,
        tls: { servername: 'cache.example.com' },
        connectTimeout: 10000,
        commandTimeout: 10000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      },
    ])
  })

  it('forwards raw string and numeric arguments without coercion', async () => {
    redisMocks.call.mockResolvedValue(['0', ['key:1']])
    const client = createRedisClient({
      host: '203.0.113.10',
      port: 6379,
      db: 0,
      family: 4,
    })

    await expect(executeRedisClientCommand(client, 'SCAN', ['0', 'COUNT', 100])).resolves.toEqual([
      '0',
      ['key:1'],
    ])
    expect(redisMocks.call).toHaveBeenCalledWith('SCAN', '0', 'COUNT', 100)
  })
})
