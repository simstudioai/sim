/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAsyncToolCalls } = vi.hoisted(() => ({
  getAsyncToolCalls: vi.fn(),
}))

const channelHandlers = new Set<(event: any) => void>()

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  getAsyncToolCalls,
}))

vi.mock('@/lib/events/pubsub', () => ({
  createPubSubChannel: () => ({
    publish(event: any) {
      for (const handler of channelHandlers) handler(event)
    },
    subscribe(handler: (event: any) => void) {
      channelHandlers.add(handler)
      return () => {
        channelHandlers.delete(handler)
      }
    },
    dispose() {},
  }),
}))

import {
  getToolConfirmation,
  publishToolConfirmation,
  waitForToolConfirmation,
} from '@/lib/mothership/persistence/tool-confirm'

describe('copilot orchestrator persistence', () => {
  let row: {
    status: string
    error?: string | null
    result?: unknown
    updatedAt: Date
  } | null

  beforeEach(() => {
    vi.clearAllMocks()
    channelHandlers.clear()
    row = null
    getAsyncToolCalls.mockImplementation(async () => (row ? [row] : []))
  })

  it('reads the durable DB row as the source of truth', async () => {
    row = {
      status: 'completed',
      result: { ok: true },
      error: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await expect(getToolConfirmation('tool-1')).resolves.toEqual({
      status: 'success',
      message: undefined,
      data: { ok: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    })
  })

  it('preserves primitive durable results in confirmations', async () => {
    row = {
      status: 'completed',
      result: 'done',
      error: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await expect(getToolConfirmation('tool-1')).resolves.toEqual({
      status: 'success',
      message: undefined,
      data: 'done',
      timestamp: '2026-01-01T00:00:00.000Z',
    })
  })

  it('reconstructs background from a delivered durable row', async () => {
    row = {
      status: 'delivered',
      result: { ok: true },
      error: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await expect(getToolConfirmation('tool-1')).resolves.toEqual({
      status: 'background',
      timestamp: '2026-01-01T00:00:00.000Z',
    })
  })

  it('ignores background when waiting for a foreground terminal status', async () => {
    row = {
      status: 'pending',
      error: null,
      result: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const waitPromise = waitForToolConfirmation('tool-1', 5_000, undefined, {
      acceptStatus: (status) =>
        status === 'success' || status === 'error' || status === 'cancelled',
    })

    publishToolConfirmation({
      toolCallId: 'tool-1',
      status: 'background',
      message: 'Client disconnected, execution continuing server-side',
      timestamp: '2026-01-01T00:00:01.000Z',
    })

    await Promise.resolve()

    row = {
      status: 'completed',
      error: null,
      result: { ok: true },
      updatedAt: new Date('2026-01-01T00:00:02.000Z'),
    }

    publishToolConfirmation({
      toolCallId: 'tool-1',
      status: 'success',
      timestamp: '2026-01-01T00:00:02.000Z',
    })

    await expect(waitPromise).resolves.toEqual({
      status: 'success',
      message: undefined,
      data: { ok: true },
      timestamp: '2026-01-01T00:00:02.000Z',
    })
  })

  it('resolves background from the pubsub event when the durable row stays pending', async () => {
    row = {
      status: 'pending',
      error: null,
      result: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const waitPromise = waitForToolConfirmation('tool-1', 5_000, undefined, {
      acceptStatus: (status) => status === 'background',
    })

    await Promise.resolve()

    publishToolConfirmation({
      toolCallId: 'tool-1',
      status: 'background',
      message: 'Client disconnected, execution continuing server-side',
      timestamp: '2026-01-01T00:00:01.000Z',
    })

    await expect(waitPromise).resolves.toEqual({
      status: 'background',
      message: 'Client disconnected, execution continuing server-side',
      timestamp: '2026-01-01T00:00:01.000Z',
    })
  })

  it('resolves background when detach completes before the waiter subscribes', async () => {
    row = {
      status: 'delivered',
      error: null,
      result: null,
      updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    }

    await expect(
      waitForToolConfirmation('tool-1', 5_000, undefined, {
        acceptStatus: (status) => status === 'background',
      })
    ).resolves.toEqual({
      status: 'background',
      timestamp: '2026-01-01T00:00:01.000Z',
    })
  })

  it('keeps a no-deadline human wait alive until confirmation arrives', async () => {
    vi.useFakeTimers()
    try {
      row = {
        status: 'pending',
        error: null,
        result: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }
      let settled = false
      const waitPromise = waitForToolConfirmation('tool-1', null, undefined, {
        acceptStatus: (status) =>
          status === 'success' || status === 'error' || status === 'cancelled',
      }).then((result) => {
        settled = true
        return result
      })

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(false)

      row = {
        status: 'completed',
        error: null,
        result: { ok: true },
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      }
      publishToolConfirmation({
        toolCallId: 'tool-1',
        status: 'success',
        timestamp: '2026-01-02T00:00:00.000Z',
      })

      await expect(waitPromise).resolves.toEqual({
        status: 'success',
        message: undefined,
        data: { ok: true },
        timestamp: '2026-01-02T00:00:00.000Z',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([null, 20_000])(
    'catches up from durable state when a waiter with deadline %s misses pubsub',
    async (timeoutMs) => {
      vi.useFakeTimers()
      try {
        row = {
          status: 'pending',
          error: null,
          result: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }
        const waitPromise = waitForToolConfirmation('tool-1', timeoutMs, undefined, {
          acceptStatus: (status) =>
            status === 'success' || status === 'error' || status === 'cancelled',
        })
        await vi.advanceTimersByTimeAsync(0)

        row = {
          status: 'completed',
          error: null,
          result: { recovered: true },
          updatedAt: new Date('2026-01-01T00:00:01.000Z'),
        }
        await vi.advanceTimersByTimeAsync(5_000)

        await expect(waitPromise).resolves.toMatchObject({
          status: 'success',
          data: { recovered: true },
        })
        const callsAfterSettle = getAsyncToolCalls.mock.calls.length
        await vi.advanceTimersByTimeAsync(5_000)
        expect(getAsyncToolCalls).toHaveBeenCalledTimes(callsAfterSettle)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('stops durable catch-up polling when aborted', async () => {
    vi.useFakeTimers()
    try {
      row = {
        status: 'pending',
        error: null,
        result: null,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }
      const controller = new AbortController()
      const waitPromise = waitForToolConfirmation('tool-1', null, controller.signal, {
        acceptStatus: (status) =>
          status === 'success' || status === 'error' || status === 'cancelled',
      })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await expect(waitPromise).resolves.toBeNull()

      const callsAfterAbort = getAsyncToolCalls.mock.calls.length
      await vi.advanceTimersByTimeAsync(5_000)
      expect(getAsyncToolCalls).toHaveBeenCalledTimes(callsAfterAbort)
    } finally {
      vi.useRealTimers()
    }
  })
})
