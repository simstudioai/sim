/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runPass: vi.fn(),
  resolveRegion: vi.fn(),
  trigger: vi.fn(),
  execute: vi.fn(),
  isFeatureEnabled: vi.fn(),
}))

vi.mock('@sim/db', () => ({ db: { execute: mocks.execute } }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: mocks.isFeatureEnabled }))

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mocks.trigger } }))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: mocks.resolveRegion }))
vi.mock('@/lib/core/config/env-flags', () => ({ isTriggerDevEnabled: true }))
vi.mock('@/lib/knowledge/projection/run', () => ({ runKnowledgeProjectionPass: mocks.runPass }))

import {
  enqueueKnowledgeProjectionSweep,
  requestKnowledgeProjection,
} from '@/lib/knowledge/projection/enqueue'

describe('knowledge projection enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:34:45.000Z'))
    mocks.resolveRegion.mockResolvedValue('us-east-1')
    mocks.trigger.mockResolvedValue({ id: 'run-1' })
    mocks.execute.mockResolvedValue([{ pending: true }])
    mocks.isFeatureEnabled.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enqueues one sweep pass per window and never runs the pass inline', async () => {
    await expect(enqueueKnowledgeProjectionSweep()).resolves.toEqual({
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
    expect(mocks.trigger).toHaveBeenCalledWith('knowledge-projection', undefined, {
      idempotencyKey: 'knowledge-projection:sweep:29836114',
      idempotencyKeyTTL: '5m',
      region: 'us-east-1',
      ttl: '5m',
    })
    expect(mocks.runPass).not.toHaveBeenCalled()
  })

  it('starts no sweep pass when nothing is marked or left to fill', async () => {
    mocks.execute.mockResolvedValue([{ pending: false }])
    await expect(enqueueKnowledgeProjectionSweep()).resolves.toEqual({
      triggered: false,
      backend: null,
      jobId: null,
    })
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it('probes for unfilled rows only while the fill is on', async () => {
    const probed = async () => {
      mocks.execute.mockClear()
      await enqueueKnowledgeProjectionSweep()
      return JSON.stringify(mocks.execute.mock.calls[0]?.[0])
    }
    expect(await probed()).not.toContain('acl IS NULL')
    mocks.isFeatureEnabled.mockResolvedValue(true)
    const withFill = await probed()
    expect(withFill).toContain('embedding_search WHERE acl IS NULL')
    expect(withFill).toContain('embedding_keyword_tin WHERE acl IS NULL')
  })

  it('debounces prompt requests across processes and collapses them within one', async () => {
    await requestKnowledgeProjection()
    await requestKnowledgeProjection()
    expect(mocks.trigger).toHaveBeenCalledTimes(1)
    expect(mocks.trigger).toHaveBeenCalledWith('knowledge-projection', undefined, {
      debounce: { key: 'knowledge-projection', delay: '5s', maxDelay: '1m' },
      region: 'us-east-1',
    })
    vi.advanceTimersByTime(5_000)
    await requestKnowledgeProjection()
    expect(mocks.trigger).toHaveBeenCalledTimes(2)
  })

  it('never fails the write that asked when the request is refused', async () => {
    vi.advanceTimersByTime(60_000)
    mocks.trigger.mockRejectedValueOnce(new Error('trigger unavailable'))
    await expect(requestKnowledgeProjection()).resolves.toBeUndefined()
  })
})
