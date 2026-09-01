/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operationMocks = vi.hoisted(() => {
  class RedisOperationInputError extends Error {
    constructor(readonly responseError: string | undefined) {
      super(responseError)
    }
  }

  return {
    executeRedisCommand: vi.fn(),
    RedisOperationInputError,
  }
})

vi.mock('@/lib/internal/redis/operations', () => operationMocks)

import { executeRedisTool } from '@/lib/internal/redis/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const REDIS_TOOL_IDS = [
  'redis_command',
  'redis_delete',
  'redis_exists',
  'redis_expire',
  'redis_get',
  'redis_hdel',
  'redis_hget',
  'redis_hgetall',
  'redis_hset',
  'redis_incr',
  'redis_incrby',
  'redis_keys',
  'redis_llen',
  'redis_lpop',
  'redis_lpush',
  'redis_lrange',
  'redis_persist',
  'redis_rpop',
  'redis_rpush',
  'redis_set',
  'redis_setnx',
  'redis_ttl',
] as const

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'redis_command',
    input: {
      url: 'redis://cache.example.com/2',
      command: 'scan',
      args: ['0', 'MATCH', 'user:*', 100],
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeRedisTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates the canonical body and preserves raw Redis response shapes', async () => {
    const controller = new AbortController()
    operationMocks.executeRedisCommand.mockResolvedValue({
      result: ['0', ['user:1', 'user:2']],
    })

    const response = await executeRedisTool(createRequest({ signal: controller.signal }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      result: ['0', ['user:1', 'user:2']],
    })
    expect(operationMocks.executeRedisCommand).toHaveBeenCalledWith(
      {
        url: 'redis://cache.example.com/2',
        command: 'scan',
        args: ['0', 'MATCH', 'user:*', 100],
      },
      controller.signal
    )
  })

  it('returns the route-compatible first validation error', async () => {
    const response = await executeRedisTool(createRequest({ input: { url: '', command: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Redis connection URL is required',
    })
    expect(operationMocks.executeRedisCommand).not.toHaveBeenCalled()
  })

  it('rejects non-object operation input', async () => {
    const response = await executeRedisTool(createRequest({ input: '{' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid input: expected object, received string',
    })
    expect(operationMocks.executeRedisCommand).not.toHaveBeenCalled()
  })

  it.each(REDIS_TOOL_IDS)('recognizes the canonical tool ID %s', async (toolId) => {
    const response = await executeRedisTool(createRequest({ toolId, input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: expect.any(String) })
  })

  it('preserves Redis input errors as HTTP 400 responses', async () => {
    operationMocks.executeRedisCommand.mockRejectedValue(
      new operationMocks.RedisOperationInputError(
        "Invalid Redis database index in URL path: 'invalid'"
      )
    )

    const response = await executeRedisTool(createRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid Redis database index in URL path: 'invalid'",
    })
  })

  it('preserves the provider error envelope', async () => {
    operationMocks.executeRedisCommand.mockRejectedValue(new Error('connection refused'))

    const response = await executeRedisTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'connection refused' })
  })

  it('propagates cancellation without converting it into a Redis failure', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeRedisTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(operationMocks.executeRedisCommand).not.toHaveBeenCalled()
  })
})
