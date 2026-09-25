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
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
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
})
