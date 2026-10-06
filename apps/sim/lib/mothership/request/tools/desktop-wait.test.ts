import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  mothershipClientToolWaiterMock,
  mothershipClientToolWaiterMockFns,
} from '@sim/testing/mocks/mothership-client-tool-waiter.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)
vi.mock('@/lib/mothership/request/tools/client', () => mothershipClientToolWaiterMock)

import { waitForDesktopToolCall } from '@/lib/mothership/request/tools/desktop-wait'

const waitForClientToolCompletion =
  mothershipClientToolWaiterMockFns.mockWaitForClientToolCompletion
const completePendingAsyncToolCall = mothershipAsyncRunsMockFns.mockCompletePendingAsyncToolCall

const GRACE_MS = 15_000
const params = {
  toolCallId: 'browser-call',
  runId: 'run-1',
  userId: 'user-1',
  timeoutMs: 3_600_000,
  pickupGraceMs: GRACE_MS,
}
const desktopResult = { status: 'success' as const, message: 'Tool completed', data: { tabs: 2 } }

describe('waitForDesktopToolCall', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the desktop result that landed as the pickup grace ran out', async () => {
    waitForClientToolCompletion.mockImplementationOnce(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((resolve) => {
          // The confirmation arrived at the grace boundary: the waiter is already restoring it,
          // so stopping the wait no longer turns it into a missing result.
          abortSignal.addEventListener('abort', () => resolve(desktopResult), { once: true })
        })
    )

    const answer = waitForDesktopToolCall(params)
    await vi.advanceTimersByTimeAsync(GRACE_MS)

    expect(await answer).toEqual(desktopResult)
  })

  it('settles an unclaimed call as never started when its wait ends before the grace', async () => {
    waitForClientToolCompletion.mockResolvedValueOnce(null)
    completePendingAsyncToolCall.mockImplementationOnce(async (input) => ({ ...input }))

    const answer = await waitForDesktopToolCall({ ...params, timeoutMs: 1_000 })

    expect(answer).toMatchObject({ status: 'error', data: { notStarted: true } })
  })
})
