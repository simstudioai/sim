import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { mockEnvObject } from '@sim/testing/mocks/env.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { tasks } from '@trigger.dev/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  runPass: vi.fn(),
  insideRun: vi.fn(),
  pending: vi.fn(),
}))

vi.mock('@sim/db/knowledge-projection', () => ({
  releaseSettledMarks: async () => ({ released: 0, drained: true, empty: false }),
  MARK_RELEASE_BUDGET_MS: 10_000,
  hasKnowledgeProjectionWork: hoisted.pending,
}))

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/config/trigger-runtime', () => ({ isInsideTriggerRun: hoisted.insideRun }))
vi.mock('@/lib/knowledge/projection/run', () => ({ runKnowledgeProjectionPass: hoisted.runPass }))

import { enqueueKnowledgeProjectionSweep } from '@/lib/knowledge/projection/enqueue'

const mocks = {
  ...hoisted,
  resolveRegion: asyncJobsRegionMockFns.mockResolveTriggerRegion,
}

setEnvFlags({ isTriggerDevEnabled: true })

const mockTrigger = vi.mocked(tasks.trigger)

describe('knowledge projection enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:34:45.000Z'))
    mocks.resolveRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
    mocks.pending.mockResolvedValue(true)
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
})
