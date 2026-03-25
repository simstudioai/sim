/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  orchestrateCopilotStream,
  createRunSegment,
  updateRunStatus,
  resetOutbox,
  allocateCursor,
  appendEnvelope,
  cleanupAbortMarker,
  hasAbortMarker,
} = vi.hoisted(() => ({
  orchestrateCopilotStream: vi.fn(),
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  resetOutbox: vi.fn(),
  allocateCursor: vi.fn(),
  appendEnvelope: vi.fn(),
  cleanupAbortMarker: vi.fn(),
  hasAbortMarker: vi.fn(),
}))

vi.mock('@/lib/copilot/orchestrator', () => ({
  orchestrateCopilotStream,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

let mockPublisherController: ReadableStreamDefaultController | null = null

vi.mock('@/lib/copilot/mothership-stream', () => ({
  resetOutbox,
  allocateCursor,
  appendEnvelope,
  cleanupAbortMarker,
  hasAbortMarker,
  registerActiveStream: vi.fn(),
  unregisterActiveStream: vi.fn(),
  startAbortPoller: vi.fn().mockReturnValue(setInterval(() => {}, 999999)),
  SSE_RESPONSE_HEADERS: {},
  StreamPublisher: vi.fn().mockImplementation(() => ({
    attach: vi.fn().mockImplementation((ctrl: ReadableStreamDefaultController) => {
      mockPublisherController = ctrl
    }),
    startKeepalive: vi.fn(),
    stopKeepalive: vi.fn(),
    close: vi.fn().mockImplementation(() => {
      try {
        mockPublisherController?.close()
      } catch {
        // already closed
      }
    }),
    markDisconnected: vi.fn(),
    publish: vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      appendEnvelope(event)
    }),
    get clientDisconnected() {
      return false
    },
    get sawComplete() {
      return false
    },
  })),
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

vi.mock('@/lib/copilot/task-events', () => ({
  taskPubSub: null,
}))

import { createSSEStream } from './chat-streaming'

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
    resetOutbox.mockResolvedValue(undefined)
    allocateCursor
      .mockResolvedValueOnce({ seq: 1, cursor: '1' })
      .mockResolvedValueOnce({ seq: 2, cursor: '2' })
      .mockResolvedValueOnce({ seq: 3, cursor: '3' })
    appendEnvelope.mockImplementation(async (envelope: unknown) => envelope)
    cleanupAbortMarker.mockResolvedValue(undefined)
    hasAbortMarker.mockResolvedValue(false)
    createRunSegment.mockResolvedValue(null)
    updateRunStatus.mockResolvedValue(null)
  })

  it('writes a terminal error event before close when orchestration returns success=false', async () => {
    orchestrateCopilotStream.mockResolvedValue({
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

    expect(appendEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
      })
    )
  })

  it('writes the thrown terminal error event before close for replay durability', async () => {
    orchestrateCopilotStream.mockRejectedValue(new Error('kaboom'))

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

    expect(appendEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
      })
    )
  })
})
