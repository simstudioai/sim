import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  abortManualExecution: vi.fn(),
  markExecutionCancelled: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/execution/manual-cancellation', () => ({
  abortManualExecution: hoisted.abortManualExecution,
}))
vi.mock('@/lib/execution/cancellation', () => ({
  markExecutionCancelled: hoisted.markExecutionCancelled,
}))
vi.mock('@/lib/mothership/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: vi.fn(async () => ({ settled: true })),
}))
vi.mock('@/lib/mothership/request/session', () => ({
  abortActiveStream: vi.fn(),
  waitForPendingChatStream: vi.fn(async () => true),
  releasePendingChatStream: vi.fn(),
}))
vi.mock('@/lib/mothership/async-runs/orphaned-runs', () => ({
  settleStoppedRunWithoutController: vi.fn(async () => undefined),
}))
vi.mock('@/lib/mothership/request/tools/sandbox-recovery', () => ({
  recoverSandboxProcesses: vi.fn(async () => undefined),
}))
vi.mock('@/lib/desktop/executor/doorbell', () => ({ ringDesktopInbox: vi.fn() }))

import {
  deliverRunStop,
  readStoppedRunWork,
} from '@/lib/mothership/request/application/stop-delivery'

const run = {
  id: 'run-1',
  streamId: 'stream-1',
  userId: 'user-1',
  chatId: 'chat-1',
  desktopDeviceId: null,
}

describe('a Stop', () => {
  beforeEach(() => {
    hoisted.abortManualExecution.mockReset()
    hoisted.markExecutionCancelled.mockReset().mockResolvedValue({ durablyRecorded: true })
  })

  // A synchronous run the worker waits on in slices has detached from its call: no call's abort
  // signal reaches it, so before this a Stop mid-slice left the draft running to completion.
  it('cancels the workflow runs its calls started and left running, beside its open client runs', async () => {
    mothershipAsyncRunsMockFns.mockGetUnsettledClientWorkflowExecutions.mockResolvedValueOnce([
      'client-1',
    ])
    mothershipAsyncRunsMockFns.mockGetDetachedWorkflowExecutions.mockResolvedValueOnce([
      'detached-1',
      'client-1',
    ])
    const work = await readStoppedRunWork('stream-1', 'user-1')
    expect(work).toEqual({
      clientWorkflowExecutionIds: ['client-1'],
      detachedWorkflowExecutionIds: ['detached-1', 'client-1'],
      sandboxProcesses: [],
    })

    await deliverRunStop(run, work)

    expect(hoisted.abortManualExecution.mock.calls).toEqual([['client-1'], ['detached-1']])
    expect(hoisted.markExecutionCancelled.mock.calls).toEqual([['client-1'], ['detached-1']])
  })

  it('still cancels what it found when the detached runs cannot be read', async () => {
    mothershipAsyncRunsMockFns.mockGetUnsettledClientWorkflowExecutions.mockResolvedValueOnce([
      'client-1',
    ])
    mothershipAsyncRunsMockFns.mockGetDetachedWorkflowExecutions.mockRejectedValueOnce(
      new Error('db down')
    )
    await deliverRunStop(run, await readStoppedRunWork('stream-1', 'user-1'))
    expect(hoisted.markExecutionCancelled.mock.calls).toEqual([['client-1']])
  })
})
