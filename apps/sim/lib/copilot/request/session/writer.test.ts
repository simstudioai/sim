/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/copilot/request/session'

const { appendEvents } = vi.hoisted(() => ({
  appendEvents: vi.fn(),
}))

vi.mock('@/lib/copilot/request/session/buffer', () => ({
  appendEvents,
}))

import { StreamWriter } from '@/lib/copilot/request/session/writer'

function decodeChunk(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

describe('StreamWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('enqueues before persistence completes and flushes pending writes on close', async () => {
    let releasePersist: (() => void) | null = null
    appendEvents.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePersist = resolve
        })
    )

    const writer = new StreamWriter({
      streamId: 'stream-1',
      chatId: 'chat-1',
      requestId: 'req-1',
    })

    const chunks: string[] = []
    let closeCount = 0
    const controller = {
      enqueue: vi.fn((value: Uint8Array) => {
        chunks.push(decodeChunk(value))
      }),
      close: vi.fn(() => {
        closeCount += 1
      }),
    } as unknown as ReadableStreamDefaultController

    writer.attach(controller)
    await writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'hello' },
    })

    expect(controller.enqueue).toHaveBeenCalledOnce()
    expect(appendEvents).not.toHaveBeenCalled()
    expect(chunks[0]).toContain('"text":"hello"')
    expect(closeCount).toBe(0)

    const closePromise = writer.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(appendEvents).toHaveBeenCalledOnce()
    expect(closeCount).toBe(0)

    const resolvePersist = releasePersist
    if (typeof resolvePersist === 'function') {
      resolvePersist()
    }
    await closePromise

    expect(closeCount).toBe(1)
  })

  it('batches publishes on the flush timer and preserves sequence order', async () => {
    vi.useFakeTimers()
    const persistedSeqs: number[] = []
    appendEvents.mockImplementation(async (envelopes) => {
      persistedSeqs.push(...envelopes.map((envelope) => envelope.seq))
      return envelopes
    })

    const writer = new StreamWriter({
      streamId: 'stream-1',
      requestId: 'req-1',
    })

    const chunks: string[] = []
    const controller = {
      enqueue: vi.fn((value: Uint8Array) => {
        chunks.push(decodeChunk(value))
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController

    writer.attach(controller)
    await Promise.all([
      writer.publish({
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'one' },
      }),
      writer.publish({
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'two' },
      }),
    ])
    expect(appendEvents).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15)
    await writer.close()

    expect(persistedSeqs).toEqual([1, 2])
    expect(appendEvents).toHaveBeenCalledWith([
      expect.objectContaining({ seq: 1 }),
      expect.objectContaining({ seq: 2 }),
    ])
    expect(chunks[0]).toContain('"seq":1')
    expect(chunks[1]).toContain('"seq":2')
  })

  it('flush waits for persistence and surfaces failures', async () => {
    appendEvents.mockRejectedValueOnce(new Error('redis down'))

    const writer = new StreamWriter({
      streamId: 'stream-1',
      requestId: 'req-1',
    })

    writer.attach({
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController)

    await writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'boom' },
    })

    await expect(writer.flush()).rejects.toThrow('redis down')
  })

  it('persists synthetic preview events alongside contract events', async () => {
    appendEvents.mockResolvedValue([])

    const writer = new StreamWriter({
      streamId: 'stream-1',
      requestId: 'req-1',
    })

    const chunks: string[] = []
    writer.attach({
      enqueue: vi.fn((value: Uint8Array) => {
        chunks.push(decodeChunk(value))
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController)

    await writer.publish({
      type: MothershipStreamV1EventType.tool,
      payload: {
        toolCallId: 'preview-1',
        toolName: 'workspace_file',
        previewPhase: 'file_preview_start',
      },
    } satisfies StreamEvent)

    await writer.flush()

    expect(chunks[0]).toContain('"previewPhase":"file_preview_start"')
    expect(appendEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        type: MothershipStreamV1EventType.tool,
        payload: expect.objectContaining({
          toolCallId: 'preview-1',
          previewPhase: 'file_preview_start',
        }),
      }),
    ])
  })
})
