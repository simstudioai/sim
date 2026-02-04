/**
 * @vitest-environment node
 */
import { createMockRedis, loggerMock, type MockRedis } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => loggerMock)

import {
  JOB_MAX_LIFETIME_SECONDS,
  JOB_RETENTION_SECONDS,
  JOB_STATUS,
} from '@/lib/core/async-jobs/types'
import { RedisJobQueue } from './redis'

describe('RedisJobQueue', () => {
  let mockRedis: MockRedis
  let queue: RedisJobQueue

  beforeEach(() => {
    vi.clearAllMocks()
    mockRedis = createMockRedis()
    queue = new RedisJobQueue(mockRedis as never)
  })

  describe('enqueue', () => {
    it.concurrent('should create a job with pending status', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)

      const jobId = await localQueue.enqueue('workflow-execution', { test: 'data' })

      expect(jobId).toMatch(/^run_/)
      expect(localRedis.hset).toHaveBeenCalledTimes(1)

      const [key, data] = localRedis.hset.mock.calls[0]
      expect(key).toBe(`async-jobs:job:${jobId}`)
      expect(data.status).toBe(JOB_STATUS.PENDING)
      expect(data.type).toBe('workflow-execution')
    })

    it.concurrent('should set max lifetime TTL on enqueue', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)

      const jobId = await localQueue.enqueue('workflow-execution', { test: 'data' })

      expect(localRedis.expire).toHaveBeenCalledWith(
        `async-jobs:job:${jobId}`,
        JOB_MAX_LIFETIME_SECONDS
      )
    })
  })

  describe('completeJob', () => {
    it.concurrent('should set status to completed and set TTL', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)
      const jobId = 'run_test123'

      await localQueue.completeJob(jobId, { result: 'success' })

      expect(localRedis.hset).toHaveBeenCalledWith(`async-jobs:job:${jobId}`, {
        status: JOB_STATUS.COMPLETED,
        completedAt: expect.any(String),
        output: JSON.stringify({ result: 'success' }),
        updatedAt: expect.any(String),
      })
      expect(localRedis.expire).toHaveBeenCalledWith(
        `async-jobs:job:${jobId}`,
        JOB_RETENTION_SECONDS
      )
    })

    it.concurrent('should set TTL to 24 hours (86400 seconds)', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)

      await localQueue.completeJob('run_test123', {})

      expect(localRedis.expire).toHaveBeenCalledWith(expect.any(String), 86400)
    })
  })

  describe('markJobFailed', () => {
    it.concurrent('should set status to failed and set TTL', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)
      const jobId = 'run_test456'
      const error = 'Something went wrong'

      await localQueue.markJobFailed(jobId, error)

      expect(localRedis.hset).toHaveBeenCalledWith(`async-jobs:job:${jobId}`, {
        status: JOB_STATUS.FAILED,
        completedAt: expect.any(String),
        error,
        updatedAt: expect.any(String),
      })
      expect(localRedis.expire).toHaveBeenCalledWith(
        `async-jobs:job:${jobId}`,
        JOB_RETENTION_SECONDS
      )
    })

    it.concurrent('should set TTL to 24 hours (86400 seconds)', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)

      await localQueue.markJobFailed('run_test456', 'error')

      expect(localRedis.expire).toHaveBeenCalledWith(expect.any(String), 86400)
    })
  })

  describe('startJob', () => {
    it.concurrent('should not set TTL when starting a job', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)

      await localQueue.startJob('run_test789')

      expect(localRedis.hset).toHaveBeenCalled()
      expect(localRedis.expire).not.toHaveBeenCalled()
    })
  })

  describe('getJob', () => {
    it.concurrent('should return null for non-existent job', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)
      localRedis.hgetall.mockResolvedValue({})

      const job = await localQueue.getJob('run_nonexistent')

      expect(job).toBeNull()
    })

    it.concurrent('should deserialize job data correctly', async () => {
      const localRedis = createMockRedis()
      const localQueue = new RedisJobQueue(localRedis as never)
      const now = new Date()
      localRedis.hgetall.mockResolvedValue({
        id: 'run_test',
        type: 'workflow-execution',
        payload: JSON.stringify({ foo: 'bar' }),
        status: JOB_STATUS.COMPLETED,
        createdAt: now.toISOString(),
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        attempts: '1',
        maxAttempts: '3',
        error: '',
        output: JSON.stringify({ result: 'ok' }),
        metadata: JSON.stringify({ workflowId: 'wf_123' }),
      })

      const job = await localQueue.getJob('run_test')

      expect(job).not.toBeNull()
      expect(job?.id).toBe('run_test')
      expect(job?.type).toBe('workflow-execution')
      expect(job?.payload).toEqual({ foo: 'bar' })
      expect(job?.status).toBe(JOB_STATUS.COMPLETED)
      expect(job?.output).toEqual({ result: 'ok' })
      expect(job?.metadata.workflowId).toBe('wf_123')
    })
  })
})

describe('JOB_RETENTION_SECONDS', () => {
  it.concurrent('should be 24 hours in seconds', async () => {
    expect(JOB_RETENTION_SECONDS).toBe(24 * 60 * 60)
    expect(JOB_RETENTION_SECONDS).toBe(86400)
  })
})
