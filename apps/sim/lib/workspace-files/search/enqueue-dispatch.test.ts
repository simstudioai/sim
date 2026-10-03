import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}))

vi.mock('@/background/workspace-file-search-dispatch', () => ({
  workspaceFileSearchDispatchTask: {},
}))
vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/workspace-files/search/dispatcher', () => ({
  dispatchWorkspaceFileSearchIndexJobs: mocks.dispatch,
}))

import { tasks } from '@trigger.dev/sdk'
import { enqueueWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/enqueue-dispatch'

const mockTrigger = vi.mocked(tasks.trigger)

setEnvFlags({ isTriggerDevEnabled: true })
afterAll(resetEnvFlagsMock)

describe('workspace file search dispatcher enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T12:34:45.000Z'))
    asyncJobsRegionMockFns.mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits only for durable Trigger.dev acceptance and does not run the dispatcher inline', async () => {
    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
      backend: 'trigger-dev',
      jobId: 'run-1',
    })

    expect(mockTrigger).toHaveBeenCalledWith('workspace-file-search-dispatch', undefined, {
      idempotencyKey: 'workspace-file-search-dispatch:29800114',
      idempotencyKeyTTL: '5m',
      maxDuration: 60,
      region: 'us-east-1',
      ttl: '5m',
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(backgroundTaskMockFns.mockRunDetached).not.toHaveBeenCalled()
  })
})
