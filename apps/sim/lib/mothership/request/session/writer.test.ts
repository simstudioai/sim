/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/mothership/generated/mothership-stream-v1'
import type { StreamEvent } from '@/lib/mothership/request/session'

const { appendEvents } = vi.hoisted(() => ({
  appendEvents: vi.fn(),
}))

vi.mock('@/lib/mothership/request/session/buffer', () => ({
  appendEvents,
}))

import { StreamWriter } from '@/lib/mothership/request/session/writer'

function decodeChunk(value: Uint8Array): string {
  return new TextDecoder().decode(value)
}

describe('StreamWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('continues the saved cursor only after the current controller has durably appended the event', async () => {
    let persist!: () => void
    appendEvents.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve
        })
    )
    const lease = { key: 'chat-lock', value: 'stream-1\ncontroller-2' }
    const writer = new StreamWriter({
      streamId: 'stream-1',
      requestId: 'req-1',
      lease,
      initialSeq: 12,
    })
    const controller = { enqueue: vi.fn(), close: vi.fn() }
    writer.attach(controller as unknown as ReadableStreamDefaultController)
    const published = writer.publish({
      type: 'text',
      payload: { channel: 'assistant', text: 'suffix' },
    })
    await Promise.resolve()
    expect(appendEvents).toHaveBeenCalledWith([expect.objectContaining({ seq: 13 })], lease)
    expect(controller.enqueue).not.toHaveBeenCalled()
    persist()
    await published
    expect(controller.enqueue).toHaveBeenCalledOnce()
    await writer.close()
  })

  it('does not deliver an event from a controller whose durable append was rejected', async () => {
    appendEvents.mockRejectedValueOnce(new Error('ownership lost'))
    const writer = new StreamWriter({
      streamId: 'stream-1',
      requestId: 'req-1',
      lease: { key: 'chat-lock', value: 'old-controller' },
    })
    const controller = { enqueue: vi.fn(), close: vi.fn() }
    writer.attach(controller as unknown as ReadableStreamDefaultController)
    await expect(
      writer.publish({ type: 'text', payload: { channel: 'assistant', text: 'stale' } })
    ).rejects.toThrow('ownership lost')
    expect(controller.enqueue).not.toHaveBeenCalled()
    await expect(writer.close()).rejects.toThrow('ownership lost')
    expect(controller.close).toHaveBeenCalledOnce()
  })

  it('enqueues before persistence completes and flushes pending writes on close', async () => {
    let releasePersist!: () => void
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

    releasePersist()
    await closePromise

    expect(closeCount).toBe(1)
  })

  it('batches publishes on the flush timer and preserves sequence order', async () => {
    vi.useFakeTimers()
    const persistedSeqs: number[] = []
    appendEvents.mockImplementation(async (envelopes) => {
      persistedSeqs.push(...envelopes.map((envelope: { seq: number }) => envelope.seq))
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
        toolName: 'prepare_file_edit',
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
