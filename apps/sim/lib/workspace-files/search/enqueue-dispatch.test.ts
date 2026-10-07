import { asyncJobsRegionMock } from '@sim/testing/mocks/async-jobs-region.mock'
import { backgroundTaskMock } from '@sim/testing/mocks/background-task.mock'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  createIdempotentTasksTrigger,
  triggerSdkMockFns,
} from '@sim/testing/mocks/trigger-sdk.mock'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasWork: vi.fn(),
}))

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/workspace-files/search/dispatcher', () => ({
  dispatchWorkspaceFileSearchIndexJobs: vi.fn(),
  hasWorkspaceFileSearchDispatchWork: mocks.hasWork,
}))

import { enqueueWorkspaceFileSearchDispatch } from '@/lib/workspace-files/search/enqueue-dispatch'

afterAll(resetEnvFlagsMock)

describe('workspace file search dispatcher enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T12:34:45.000Z'))
    setEnvFlags({ isTriggerDevEnabled: true })
    triggerSdkMockFns.mockTasksTrigger.mockImplementation(createIdempotentTasksTrigger())
    mocks.hasWork.mockReset()
    mocks.hasWork.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the Trigger.dev run once it is accepted', async () => {
    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
  })

  it('folds ticks into the run of the window their work check was made in', async () => {
    const first = await enqueueWorkspaceFileSearchDispatch()
    mocks.hasWork.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(60_000)
      return true
    })
    const checkedAcrossTheBoundary = await enqueueWorkspaceFileSearchDispatch()
    const nextWindow = await enqueueWorkspaceFileSearchDispatch()

    expect(first.jobId).toBe('run-1')
    expect(checkedAcrossTheBoundary.jobId).toBe('run-1')
    expect(nextWindow.jobId).toBe('run-2')
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
    }
  )

  it('still starts a dispatcher run when the work check fails', async () => {
    mocks.hasWork.mockRejectedValue(new Error('statement timeout'))

    await expect(enqueueWorkspaceFileSearchDispatch()).resolves.toEqual({
      triggered: true,
      backend: 'trigger-dev',
      jobId: 'run-1',
    })
  })
})
