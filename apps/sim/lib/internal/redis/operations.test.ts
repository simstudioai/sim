/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createRedisClient: vi.fn(),
  executeRedisClientCommand: vi.fn(),
}))

const validationMocks = vi.hoisted(() => ({
  validateDatabaseHost: vi.fn(),
}))

vi.mock('@/lib/internal/redis/client', () => clientMocks)
vi.mock('@/lib/core/security/input-validation.server', () => validationMocks)

import { executeRedisCommand, RedisOperationInputError } from '@/lib/internal/redis/operations'

function createClient() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
    disconnect: vi.fn(),
  }
}

describe('Redis operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
  })

  it('resolves the host, parses connection options, and preserves raw command results', async () => {
    const controller = new AbortController()
    const client = createClient()
    clientMocks.createRedisClient.mockReturnValue(client)
    clientMocks.executeRedisClientCommand.mockResolvedValue(['0', ['user:1', 'user:2']])

    await expect(
      executeRedisCommand(
        {
          url: 'rediss://user%40name:pass%20word@cache.example.com:6380/2',
          command: 'scan',
          args: ['0', 'MATCH', 'user:*', 100],
        },
        controller.signal
      )
    ).resolves.toEqual({ result: ['0', ['user:1', 'user:2']] })

    expect(validationMocks.validateDatabaseHost).toHaveBeenCalledWith('cache.example.com', 'host')
    expect(clientMocks.createRedisClient).toHaveBeenCalledWith({
      host: '203.0.113.10',
      port: 6380,
      username: 'user@name',
      password: 'pass word',
      db: 2,
      family: 4,
      tlsServername: 'cache.example.com',
    })
    expect(client.connect).toHaveBeenCalledOnce()
    expect(clientMocks.executeRedisClientCommand).toHaveBeenCalledWith(client, 'SCAN', [
      '0',
      'MATCH',
      'user:*',
      100,
    ])
    expect(client.quit).toHaveBeenCalledOnce()
    expect(client.disconnect).not.toHaveBeenCalled()
  })

  it('uses the validated IPv6 address and default connection values', async () => {
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '2001:db8::10',
    })
    const client = createClient()
    clientMocks.createRedisClient.mockReturnValue(client)
    clientMocks.executeRedisClientCommand.mockResolvedValue('value')

    await executeRedisCommand({
      url: 'redis://[2001:db8::1]',
      command: 'get',
      args: ['key'],
    })

    expect(validationMocks.validateDatabaseHost).toHaveBeenCalledWith('2001:db8::1', 'host')
    expect(clientMocks.createRedisClient).toHaveBeenCalledWith({
      host: '2001:db8::10',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 0,
      family: 6,
      tlsServername: undefined,
    })
  })

  it('rejects an unsafe host before creating a Redis client', async () => {
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'Private network addresses are not allowed',
    })

    await expect(
      executeRedisCommand({
        url: 'redis://127.0.0.1',
        command: 'get',
        args: ['key'],
      })
    ).rejects.toEqual(new RedisOperationInputError('Private network addresses are not allowed'))
    expect(clientMocks.createRedisClient).not.toHaveBeenCalled()
  })

  it('preserves the exact invalid database index error', async () => {
    await expect(
      executeRedisCommand({
        url: 'redis://cache.example.com/01',
        command: 'get',
        args: ['key'],
      })
    ).rejects.toEqual(
      new RedisOperationInputError("Invalid Redis database index in URL path: '01'")
    )
    expect(clientMocks.createRedisClient).not.toHaveBeenCalled()
  })

  it('quits the client after a provider failure and preserves the primary error', async () => {
    const client = createClient()
    clientMocks.createRedisClient.mockReturnValue(client)
    clientMocks.executeRedisClientCommand.mockRejectedValue(new Error('provider failed'))

    await expect(
      executeRedisCommand({
        url: 'redis://cache.example.com',
        command: 'get',
        args: ['key'],
      })
    ).rejects.toThrow('provider failed')
    expect(client.quit).toHaveBeenCalledOnce()
  })

  it('disconnects and surfaces a cleanup failure after successful provider work', async () => {
    const client = createClient()
    client.quit.mockRejectedValue(new Error('quit failed'))
    clientMocks.createRedisClient.mockReturnValue(client)
    clientMocks.executeRedisClientCommand.mockResolvedValue('value')

    await expect(
      executeRedisCommand({
        url: 'redis://cache.example.com',
        command: 'get',
        args: ['key'],
      })
    ).rejects.toThrow('quit failed')
    expect(client.quit).toHaveBeenCalledTimes(2)
    expect(client.disconnect).toHaveBeenCalledOnce()
  })

  it('disconnects on cancellation and propagates the abort reason', async () => {
    const controller = new AbortController()
    const client = createClient()
    clientMocks.createRedisClient.mockReturnValue(client)
    clientMocks.executeRedisClientCommand.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      throw new Error('connection closed')
    })

    await expect(
      executeRedisCommand(
        {
          url: 'redis://cache.example.com',
          command: 'get',
          args: ['key'],
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(client.disconnect).toHaveBeenCalledOnce()
    expect(client.quit).toHaveBeenCalledOnce()
  })
})
