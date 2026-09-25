import { redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { HostedKeyQueue } from './queue'

interface MockPipeline {
  rpush: Mock
  expire: Mock
  set: Mock
  lrem: Mock
  del: Mock
  exec: Mock
}

interface MockRedis {
  multi: Mock
  set: Mock
  eval: Mock
  pipeline: MockPipeline
}

function createFakeRedis(): MockRedis {
  const pipeline: MockPipeline = {
    rpush: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
    lrem: vi.fn(),
    del: vi.fn(),
    exec: vi.fn(),
  }
  // Pipeline methods return the pipeline for chaining.
  pipeline.rpush.mockReturnValue(pipeline)
  pipeline.expire.mockReturnValue(pipeline)
  pipeline.set.mockReturnValue(pipeline)
  pipeline.lrem.mockReturnValue(pipeline)
  pipeline.del.mockReturnValue(pipeline)

  return {
    multi: vi.fn(() => pipeline),
    set: vi.fn(),
    eval: vi.fn(),
    pipeline,
  }
}

const provider = 'exa'
const workspaceId = 'workspace-1'
const ticketId = 'ticket-1'

describe('HostedKeyQueue', () => {
  let queue: HostedKeyQueue
  let mockRedis: MockRedis

  beforeEach(() => {
    mockRedis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(mockRedis)
    queue = new HostedKeyQueue()
  })

  describe('enqueue', () => {
    it('falls back to enabled=false on Redis error', async () => {
      mockRedis.pipeline.exec.mockRejectedValueOnce(new Error('connection lost'))

      const result = await queue.enqueue(provider, workspaceId, ticketId)

      expect(result.enabled).toBe(false)
    })
  })

  describe('checkHead', () => {
    it('returns "missing" when our ticket is not in the queue', async () => {
      mockRedis.eval.mockResolvedValueOnce('missing')

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('missing')
    })

    it('fails open to "head" on Redis error so callers do not hang', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('boom'))

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('head')
    })
  })

  describe('dequeue', () => {
    it('is a no-op when Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValueOnce(null)

      await expect(queue.dequeue(provider, workspaceId, ticketId)).resolves.toBeUndefined()
      expect(mockRedis.multi).not.toHaveBeenCalled()
    })

    it('swallows errors so callers do not throw on cleanup', async () => {
      mockRedis.pipeline.exec.mockRejectedValueOnce(new Error('connection lost'))

      await expect(queue.dequeue(provider, workspaceId, ticketId)).resolves.toBeUndefined()
    })
  })
})
