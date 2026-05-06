/**
 * @vitest-environment node
 */

import { redisConfigMock, redisConfigMockFns } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockHasAbortMarker, mockClearAbortMarker, mockWriteAbortMarker } = vi.hoisted(() => ({
  mockHasAbortMarker: vi.fn().mockResolvedValue(false),
  mockClearAbortMarker: vi.fn().mockResolvedValue(undefined),
  mockWriteAbortMarker: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@/lib/copilot/request/session/buffer', () => ({
  hasAbortMarker: mockHasAbortMarker,
  clearAbortMarker: mockClearAbortMarker,
  writeAbortMarker: mockWriteAbortMarker,
}))
vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (_span: unknown, _attrs: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
}))

import { startAbortPoller } from '@/lib/copilot/request/session/abort'

describe('startAbortPoller heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockHasAbortMarker.mockResolvedValue(false)
    redisConfigMockFns.mockExtendLock.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('extends the chat stream lock approximately every heartbeat interval', async () => {
    const controller = new AbortController()
    const streamId = 'stream-heartbeat-1'
    const chatId = 'chat-heartbeat-1'

    const interval = startAbortPoller(streamId, controller, { chatId })

    try {
      await vi.advanceTimersByTimeAsync(15_000)
      expect(redisConfigMockFns.mockExtendLock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(6_000)

      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(1)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenLastCalledWith(
        `copilot:chat-stream-lock:${chatId}`,
        streamId,
        60
      )

      await vi.advanceTimersByTimeAsync(20_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(20_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(3)
    } finally {
      clearInterval(interval)
    }
  })

  it('does not extend the lock when no chatId is passed (backward compat)', async () => {
    const controller = new AbortController()
    const interval = startAbortPoller('stream-no-chat', controller, {})

    try {
      await vi.advanceTimersByTimeAsync(90_000)
      expect(redisConfigMockFns.mockExtendLock).not.toHaveBeenCalled()
    } finally {
      clearInterval(interval)
    }
  })

  it('retries on the next tick when extendLock throws (no 20s backoff)', async () => {
    const controller = new AbortController()
    const streamId = 'stream-retry'
    const chatId = 'chat-retry'

    redisConfigMockFns.mockExtendLock.mockRejectedValueOnce(new Error('redis down'))

    const interval = startAbortPoller(streamId, controller, { chatId })

    try {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(2)
    } finally {
      clearInterval(interval)
    }
  })

  it('aborts the controller before clearing the marker so the marker is never observable as cleared while the signal is still unaborted', async () => {
    const controller = new AbortController()
    const streamId = 'stream-order-1'

    let signalAbortedWhenMarkerCleared: boolean | null = null
    mockClearAbortMarker.mockImplementationOnce(async () => {
      signalAbortedWhenMarkerCleared = controller.signal.aborted
    })
    mockHasAbortMarker.mockResolvedValueOnce(true)

    const interval = startAbortPoller(streamId, controller, {})

    try {
      await vi.advanceTimersByTimeAsync(300)

      expect(mockClearAbortMarker).toHaveBeenCalledWith(streamId)
      expect(signalAbortedWhenMarkerCleared).toBe(true)
      expect(controller.signal.aborted).toBe(true)
    } finally {
      clearInterval(interval)
    }
  })

  it('does not clear the marker when the signal is already aborted (no double abort)', async () => {
    const controller = new AbortController()
    controller.abort('preexisting')
    const streamId = 'stream-order-2'

    mockHasAbortMarker.mockResolvedValueOnce(true)

    const interval = startAbortPoller(streamId, controller, {})

    try {
      await vi.advanceTimersByTimeAsync(300)

      expect(mockClearAbortMarker).not.toHaveBeenCalled()
    } finally {
      clearInterval(interval)
    }
  })

  it('stops heartbeating after ownership is lost', async () => {
    const controller = new AbortController()
    const streamId = 'stream-lost'
    const chatId = 'chat-lost'

    redisConfigMockFns.mockExtendLock.mockResolvedValueOnce(false)

    const interval = startAbortPoller(streamId, controller, { chatId })

    try {
      await vi.advanceTimersByTimeAsync(21_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(redisConfigMockFns.mockExtendLock).toHaveBeenCalledTimes(1)
    } finally {
      clearInterval(interval)
    }
  })
})
