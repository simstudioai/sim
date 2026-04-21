/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/copilot/generated/mothership-stream-v1'

const {
  runCopilotLifecycle,
  createRunSegment,
  updateRunStatus,
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  releasePendingChatStream,
} = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  resetBuffer: vi.fn(),
  clearFilePreviewSessions: vi.fn(),
  scheduleBufferCleanup: vi.fn(),
  scheduleFilePreviewSessionCleanup: vi.fn(),
  allocateCursor: vi.fn(),
  appendEvent: vi.fn(),
  cleanupAbortMarker: vi.fn(),
  hasAbortMarker: vi.fn(),
  releasePendingChatStream: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

let mockPublisherController: ReadableStreamDefaultController | null = null

vi.mock('@/lib/copilot/request/session', () => ({
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  releasePendingChatStream,
  registerActiveStream: vi.fn(),
  unregisterActiveStream: vi.fn(),
  startAbortPoller: vi.fn().mockReturnValue(setInterval(() => {}, 999999)),
  SSE_RESPONSE_HEADERS: {},
  StreamWriter: vi.fn().mockImplementation(() => ({
    attach: vi.fn().mockImplementation((ctrl: ReadableStreamDefaultController) => {
      mockPublisherController = ctrl
    }),
    startKeepalive: vi.fn(),
    stopKeepalive: vi.fn(),
    flush: vi.fn(),
    close: vi.fn().mockImplementation(() => {
      try {
        mockPublisherController?.close()
      } catch {
        // already closed
      }
    }),
    markDisconnected: vi.fn(),
    publish: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      appendEvent(event)
    }),
    get clientDisconnected() {
      return false
    },
    get sawComplete() {
      return false
    },
  })),
}))
vi.mock('@/lib/copilot/request/session/sse', () => ({
  SSE_RESPONSE_HEADERS: {},
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: null,
}))

import { createSSEStream } from './start'

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

describe('createSSEStream terminal error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBuffer.mockResolvedValue(undefined)
    clearFilePreviewSessions.mockResolvedValue(undefined)
    scheduleBufferCleanup.mockResolvedValue(undefined)
    scheduleFilePreviewSessionCleanup.mockResolvedValue(undefined)
    allocateCursor
      .mockResolvedValueOnce({ seq: 1, cursor: '1' })
      .mockResolvedValueOnce({ seq: 2, cursor: '2' })
      .mockResolvedValueOnce({ seq: 3, cursor: '3' })
    appendEvent.mockImplementation(async (event: unknown) => event)
    cleanupAbortMarker.mockResolvedValue(undefined)
    hasAbortMarker.mockResolvedValue(false)
    releasePendingChatStream.mockResolvedValue(undefined)
    createRunSegment.mockResolvedValue(null)
    updateRunStatus.mockResolvedValue(null)
  })

  it('writes a terminal error event before close when orchestration returns success=false', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: false,
      error: 'resume failed',
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-1',
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
  })

  it('writes the thrown terminal error event before close for replay durability', async () => {
    runCopilotLifecycle.mockRejectedValue(new Error('kaboom'))

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-1',
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
  })
})
