/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  orchestrateCopilotStream,
  createRunSegment,
  updateRunStatus,
  resetStreamBuffer,
  setStreamMeta,
  createStreamEventWriter,
} = vi.hoisted(() => ({
  orchestrateCopilotStream: vi.fn(),
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  resetStreamBuffer: vi.fn(),
  setStreamMeta: vi.fn(),
  createStreamEventWriter: vi.fn(),
}))

vi.mock('@/lib/copilot/orchestrator', () => ({
  orchestrateCopilotStream,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

vi.mock('@/lib/copilot/orchestrator/stream/buffer', () => ({
  createStreamEventWriter,
  resetStreamBuffer,
  setStreamMeta,
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

import { createSSEStream } from '@/lib/copilot/chat-streaming'

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

describe('createSSEStream terminal error handling', () => {
  const write = vi.fn().mockResolvedValue({ eventId: 1, streamId: 'stream-1', event: {} })
  const flush = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    write.mockResolvedValue({ eventId: 1, streamId: 'stream-1', event: {} })
    flush.mockResolvedValue(undefined)
    close.mockResolvedValue(undefined)
    createStreamEventWriter.mockReturnValue({ write, flush, close })
    resetStreamBuffer.mockResolvedValue(undefined)
    setStreamMeta.mockResolvedValue(undefined)
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

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: 'resume failed',
      })
    )
    expect(write.mock.invocationCallOrder.at(-1)).toBeLessThan(close.mock.invocationCallOrder[0])
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

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: 'kaboom',
      })
    )
    expect(write.mock.invocationCallOrder.at(-1)).toBeLessThan(close.mock.invocationCallOrder[0])
  })
})
