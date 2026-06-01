import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { HostedKeyQueue } from './queue'

vi.mock('@/lib/core/config/redis', () => redisConfigMock)

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
    vi.clearAllMocks()
    mockRedis = createFakeRedis()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(mockRedis)
    queue = new HostedKeyQueue()
  })

  describe('enqueue', () => {
    it('returns position 0 when first in line', async () => {
      // RPUSH returns new list length; first push -> 1.
      mockRedis.pipeline.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 1],
        [null, 'OK'],
      ])

      const result = await queue.enqueue(provider, workspaceId, ticketId)

      expect(result).toEqual({ position: 0, enabled: true })
      expect(mockRedis.pipeline.rpush).toHaveBeenCalledWith(
        'hosted-queue:exa:workspace-1',
        ticketId
      )
      expect(mockRedis.pipeline.set).toHaveBeenCalledWith(
        'hosted-queue-tkt:exa:workspace-1:ticket-1',
        '1',
        'EX',
        expect.any(Number)
      )
    })

    it('returns higher position when others are ahead', async () => {
      // Length 5 after push -> position 4.
      mockRedis.pipeline.exec.mockResolvedValueOnce([
        [null, 5],
        [null, 1],
        [null, 'OK'],
      ])

      const result = await queue.enqueue(provider, workspaceId, ticketId)

      expect(result.position).toBe(4)
    })

    it('falls back to enabled=false when Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValueOnce(null)

      const result = await queue.enqueue(provider, workspaceId, ticketId)

      expect(result).toEqual({ position: 0, enabled: false })
    })

    it('falls back to enabled=false on Redis error', async () => {
      mockRedis.pipeline.exec.mockRejectedValueOnce(new Error('connection lost'))

      const result = await queue.enqueue(provider, workspaceId, ticketId)

      expect(result.enabled).toBe(false)
    })
  })

  describe('checkHead', () => {
    it('returns "head" when our ticket is at the head', async () => {
      mockRedis.eval.mockResolvedValueOnce('head')

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('head')
    })

    it('returns "waiting" when someone else is the head', async () => {
      mockRedis.eval.mockResolvedValueOnce('waiting')

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('waiting')
    })

    it('returns "missing" when our ticket is not in the queue', async () => {
      mockRedis.eval.mockResolvedValueOnce('missing')

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('missing')
    })

    it('passes queue list key, heartbeat prefix, and ticketId to the Lua script', async () => {
      mockRedis.eval.mockResolvedValueOnce('head')

      await queue.checkHead(provider, workspaceId, ticketId)

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('lindex'),
        1,
        'hosted-queue:exa:workspace-1',
        'hosted-queue-tkt:exa:workspace-1:',
        ticketId
      )
    })

    it('fails open to "head" on Redis error so callers do not hang', async () => {
      mockRedis.eval.mockRejectedValueOnce(new Error('boom'))

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('head')
    })

    it('returns "head" no-op when Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValueOnce(null)

      const status = await queue.checkHead(provider, workspaceId, ticketId)

      expect(status).toBe('head')
    })
  })

  describe('refreshHeartbeat', () => {
    it('writes the heartbeat key with TTL and re-extends the queue list TTL', async () => {
      mockRedis.pipeline.exec.mockResolvedValueOnce([
        [null, 'OK'],
        [null, 1],
      ])

      await queue.refreshHeartbeat(provider, workspaceId, ticketId)

      expect(mockRedis.pipeline.set).toHaveBeenCalledWith(
        'hosted-queue-tkt:exa:workspace-1:ticket-1',
        '1',
        'EX',
        expect.any(Number)
      )
      expect(mockRedis.pipeline.expire).toHaveBeenCalledWith(
        'hosted-queue:exa:workspace-1',
        expect.any(Number)
      )
      expect(mockRedis.pipeline.exec).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when Redis is unavailable', async () => {
      redisConfigMockFns.mockGetRedisClient.mockReturnValueOnce(null)

      await expect(queue.refreshHeartbeat(provider, workspaceId, ticketId)).resolves.toBeUndefined()
      expect(mockRedis.multi).not.toHaveBeenCalled()
    })
  })

  describe('dequeue', () => {
    it('removes the ticket from the list and deletes the heartbeat', async () => {
      mockRedis.pipeline.exec.mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ])

      await queue.dequeue(provider, workspaceId, ticketId)

      expect(mockRedis.pipeline.lrem).toHaveBeenCalledWith(
        'hosted-queue:exa:workspace-1',
        1,
        ticketId
      )
      expect(mockRedis.pipeline.del).toHaveBeenCalledWith(
        'hosted-queue-tkt:exa:workspace-1:ticket-1'
      )
    })

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
