import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  hasWork: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/workspace-files/search/dispatcher', () => ({
  dispatchWorkspaceFileSearchIndexJobs: mocks.dispatch,
  hasWorkspaceFileSearchDispatchWork: mocks.hasWork,
}))

import { tasks } from '@trigger.dev/sdk'
import { enqueueWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/enqueue-dispatch'

const mockTrigger = vi.mocked(tasks.trigger)

afterAll(resetEnvFlagsMock)

describe('workspace file search dispatcher enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T12:34:45.000Z'))
    setEnvFlags({ isTriggerDevEnabled: true })
    asyncJobsRegionMockFns.mockResolveTriggerRegion.mockResolvedValue('us-east-1')
    mockTrigger.mockResolvedValue({ id: 'run-1' })
    mocks.hasWork.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits only for durable Trigger.dev acceptance and does not run the dispatcher inline', async () => {
    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
      triggered: true,
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

  it.each([
    { backend: 'trigger-dev', triggerDevEnabled: true },
    { backend: 'inline', triggerDevEnabled: false },
  ])(
    'starts no $backend dispatcher run when there is no dispatch work',
    async ({ triggerDevEnabled }) => {
      setEnvFlags({ isTriggerDevEnabled: triggerDevEnabled })
      mocks.hasWork.mockResolvedValue(false)

      await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
        triggered: false,
        backend: null,
        jobId: null,
      })
      expect(mockTrigger).not.toHaveBeenCalled()
      expect(backgroundTaskMockFns.mockRunDetached).not.toHaveBeenCalled()
    }
  )

  it('still starts a dispatcher run when the work check fails', async () => {
    mocks.hasWork.mockRejectedValue(new Error('statement timeout'))

    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toMatchObject({
      triggered: true,
      backend: 'trigger-dev',
    })
    expect(mockTrigger).toHaveBeenCalledTimes(1)
  })
})
