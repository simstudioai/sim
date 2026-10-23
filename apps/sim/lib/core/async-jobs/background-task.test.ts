import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  asyncJobsRegionMock,
  asyncJobsRegionMockFns,
} from '@sim/testing/mocks/async-jobs-region.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { triggerSdkMockFns } from '@sim/testing/mocks/trigger-sdk.mock'
import type { Task } from '@trigger.dev/sdk'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)

import { dispatchBackgroundTask } from '@/lib/core/async-jobs/background-task'

type FixtureTask = Task<'fixture-task', { value: number }, void>

const runInProcess = vi.fn(async () => {})

beforeEach(() => {
  runInProcess.mockClear()
  asyncJobsRegionMockFns.mockResolveTriggerRegion.mockResolvedValue('eu-central-1')
})
afterAll(resetEnvFlagsMock)

describe('dispatchBackgroundTask', () => {
  it('runs the task in this process when Trigger.dev is off, without reaching Trigger.dev', async () => {
    setEnvFlags({ isTriggerDevEnabled: false })

    await dispatchBackgroundTask<FixtureTask>('fixture-task', { value: 1 }, { runInProcess })

    expect(triggerSdkMockFns.mockTasksTrigger).not.toHaveBeenCalled()
    const [label, work] = backgroundTaskMockFns.mockRunDetached.mock.calls[0]
    expect(label).toBe('fixture-task')
    await work()
    expect(runInProcess).toHaveBeenCalledWith({ value: 1 })
  })

  it("triggers the task in the deployment's region with the caller's options", async () => {
    setEnvFlags({ isTriggerDevEnabled: true })

    await dispatchBackgroundTask<FixtureTask>(
      'fixture-task',
      { value: 2 },
      { runInProcess, trigger: { tags: ['jobId:job-1'], idempotencyKey: 'key-1' } }
    )

    expect(triggerSdkMockFns.mockTasksTrigger).toHaveBeenCalledWith(
      'fixture-task',
      { value: 2 },
      { tags: ['jobId:job-1'], idempotencyKey: 'key-1', region: 'eu-central-1' }
    )
    expect(backgroundTaskMockFns.mockRunDetached).not.toHaveBeenCalled()
  })

  it('rejects when Trigger.dev refuses the run, so the caller can undo its claim', async () => {
    setEnvFlags({ isTriggerDevEnabled: true })
    triggerSdkMockFns.mockTasksTrigger.mockRejectedValueOnce(new Error('trigger.dev unreachable'))

    await expect(
      dispatchBackgroundTask<FixtureTask>('fixture-task', { value: 3 }, { runInProcess })
    ).rejects.toThrow('trigger.dev unreachable')
    expect(runInProcess).not.toHaveBeenCalled()
  })
})
