import { mothershipAgentUrlMock } from '@sim/testing/mocks/mothership-agent-url.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

import {
  forwardRunReplay,
  openRunReplay,
  RunReplayUnavailableError,
} from '@/lib/mothership/request/session/run-replay'

/** Well past the worker idle bound, and under common intermediary idle cuts. */
const INTERMEDIARY_IDLE_MS = 300_000

function settle<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false }
  promise.then(
    (value) => {
      state.done = true
      state.value = value
    },
    (error: unknown) => {
      state.done = true
      state.error = error
    }
  )
  return state
}

describe('run replay liveness', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives up on a worker that never answers the replay request', async () => {
    vi.mocked(fetch).mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        })
    )
    const state = settle(
      openRunReplay({
        streamId: '00000000-0000-4000-8000-000000000001',
        chatId: '00000000-0000-4000-8000-000000000002',
        userId: 'user-1',
        signal: new AbortController().signal,
      })
    )

    await vi.advanceTimersByTimeAsync(INTERMEDIARY_IDLE_MS)

    expect(state.done).toBe(true)
    expect(state.error).toBeInstanceOf(RunReplayUnavailableError)
  })

  it('ends a replay whose worker goes silent so the reader can re-attach', async () => {
    const state = settle(
      forwardRunReplay({
        body: new ReadableStream<Uint8Array>(),
        streamId: 'stream-1',
        signal: new AbortController().signal,
        write: () => true,
        readRunStatus: async () => 'active',
        isClosed: () => false,
        deadlineAt: Date.now() + 60 * 60_000,
      })
    )

    await vi.advanceTimersByTimeAsync(INTERMEDIARY_IDLE_MS)

    expect(state).toMatchObject({ done: true, value: 'closed' })
  })
})
