import { beforeEach, describe, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), ping: vi.fn() }))
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => redis }))

import {
  cacheFileWorkflowResult,
  readFileWorkflowResult,
} from '@/lib/workspace-files/workflows/run-store'
import type { FileWorkflowSnapshot } from '@/lib/workspace-files/workflows/types'

const result: FileWorkflowSnapshot = {
  status: 'completed',
  executionId: 'run-1',
  deploymentVersionId: 'deployment-1',
  generatedAt: new Date().toISOString(),
  nextRunAt: new Date().toISOString(),
  output: { count: 1 },
  error: null,
}

describe('file workflow result cache', () => {
  beforeEach(() => vi.resetAllMocks())
  it('namespaces bounded cached output by audience and execution with a five-minute TTL', async () => {
    await cacheFileWorkflowResult('audience-1', result)
    expect(redis.set).toHaveBeenCalledWith(
      'file-workflow:v1:audience-1:run-1',
      JSON.stringify(result),
      'EX',
      300
    )
  })
  it('rejects oversized UTF-8 output before storing it', async () => {
    await expect(
      cacheFileWorkflowResult('audience-1', { ...result, output: '🔥'.repeat(300_000) })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(redis.set).not.toHaveBeenCalled()
  })
  it('fails on malformed cached data rather than treating corruption as an empty result', async () => {
    redis.get.mockResolvedValue('{"status":"completed"}')
    await expect(readFileWorkflowResult('audience-1', 'run-1')).rejects.toThrow()
  })
  it('distinguishes a missing entry from a Redis outage', async () => {
    redis.get.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Redis unavailable'))
    expect(await readFileWorkflowResult('audience-1', 'run-1')).toBeNull()
    await expect(readFileWorkflowResult('audience-1', 'run-1')).rejects.toThrow('Redis unavailable')
  })
})
