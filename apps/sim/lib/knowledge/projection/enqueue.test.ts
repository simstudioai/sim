import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { mockEnvObject } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { tasks } from '@trigger.dev/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  runPass: vi.fn(),
  insideRun: vi.fn(),
}))

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: hoisted.insideRun }))
vi.mock('@/lib/knowledge/projection/run', () => ({ runKnowledgeProjectionPass: hoisted.runPass }))

import {
  enqueueKnowledgeProjectionSweep,
  requestKnowledgeProjection,
} from '@/lib/knowledge/projection/enqueue'

const mocks = {
  ...hoisted,
  resolveRegion: asyncJobsRegionMockFns.mockResolveTriggerRegion,
  isFeatureEnabled: featureFlagsMockFns.mockIsFeatureEnabled,
}

setEnvFlags({ isTriggerDevEnabled: true })

const mockTrigger = vi.mocked(tasks.trigger)

describe('knowledge projection enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:34:45.000Z'))
    mocks.resolveRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
    dbChainMockFns.execute.mockResolvedValue([{ pending: true }])
    mocks.isFeatureEnabled.mockResolvedValue(false)
    mockEnvObject.TRIGGER_SECRET_KEY = 'fixture-key'
    mocks.insideRun.mockReturnValue(false)
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
    expect(mockTrigger).toHaveBeenCalledWith('knowledge-projection', undefined, {
      idempotencyKey: 'knowledge-projection:sweep:29836114',
      idempotencyKeyTTL: '5m',
      region: 'us-east-1',
      ttl: '5m',
    })
    expect(mocks.runPass).not.toHaveBeenCalled()
  })

  it('debounces prompt requests across processes and collapses them within one', async () => {
    await requestKnowledgeProjection()
    await requestKnowledgeProjection()
    expect(mockTrigger).toHaveBeenCalledTimes(1)
    expect(mockTrigger).toHaveBeenCalledWith('knowledge-projection', undefined, {
      debounce: { key: 'knowledge-projection', delay: '5s', maxDelay: '1m' },
      region: 'us-east-1',
    })
    vi.advanceTimersByTime(5_000)
    await requestKnowledgeProjection()
    expect(mockTrigger).toHaveBeenCalledTimes(2)
  })

  it('never fails the write that asked when the request is refused', async () => {
    vi.advanceTimersByTime(60_000)
    mockTrigger.mockRejectedValueOnce(new Error('trigger unavailable'))
    await expect(requestKnowledgeProjection()).resolves.toBeUndefined()
  })
})
