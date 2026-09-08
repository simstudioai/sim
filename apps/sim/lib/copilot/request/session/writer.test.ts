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
    // The buffer reports a refusal rather than throwing, so every persist resolves.
    appendEvents.mockResolvedValue({ persisted: true })
  })

  it('enqueues before persistence completes and flushes pending writes on close', async () => {
    let releasePersist: (() => void) | null = null
    appendEvents.mockImplementation(
      () =>
        new Promise<{ persisted: true }>((resolve) => {
          releasePersist = () => resolve({ persisted: true })
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
      return { persisted: true }
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
    expect(appendEvents).toHaveBeenCalledWith(
      [expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 2 })],
      { streamId: 'stream-1' }
    )
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
    appendEvents.mockResolvedValue({ persisted: true })

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
    expect(appendEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: MothershipStreamV1EventType.tool,
          payload: expect.objectContaining({
            toolCallId: 'preview-1',
            previewPhase: 'file_preview_start',
          }),
        }),
      ],
      { streamId: 'stream-1' }
    )
  })

  /**
   * A delivery failure must not cost the buffer an envelope.
   *
   * Preview content streams as deltas, so the replay chain is only reconstructible if
   * every envelope reaches Redis — including one the client never received. `publish`
   * persists after enqueuing and unconditionally, and a failed enqueue marks the
   * client disconnected rather than throwing, so the producer is never told a delivery
   * failed and never advances past a gap the buffer does not have.
   */
  it('persists an envelope whose delivery failed, and stops enqueuing after', async () => {
    appendEvents.mockResolvedValue({ persisted: true })

    const writer = new StreamWriter({
      streamId: 'stream-gap',
      chatId: 'chat-gap',
      requestId: 'req-gap',
    })

    let enqueueCalls = 0
    const controller = {
      enqueue: vi.fn(() => {
        enqueueCalls += 1
        throw new Error('client gone')
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController

    writer.attach(controller)

    expect(() =>
      writer.publish({
        type: MothershipStreamV1EventType.text,
        payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'one' },
      } as StreamEvent)
    ).not.toThrow()

    writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'two' },
    } as StreamEvent)

    await writer.flush()

    const persisted = appendEvents.mock.calls.flatMap(
      ([envelopes]: [Array<{ payload?: { text?: string } }>]) => envelopes
    )
    expect(persisted.map((envelope) => envelope.payload?.text)).toEqual(['one', 'two'])
    expect(writer.clientDisconnected).toBe(true)
    // The failed enqueue disconnects; nothing is pushed at the dead controller again.
    expect(enqueueCalls).toBe(1)
  })

  /**
   * A refused write is not a fault.
   *
   * `flush()` rethrows whatever it is handed, and that throw reaches the error-path
   * `finalizeStream`, which runs inside the catch and so escapes to reject the
   * response stream. A turn whose bytes the user already received must not end in an
   * error because its replay copy did not fit — so the buffer stops and the turn
   * finishes.
   */
  it('stops persisting on a budget refusal without failing the stream', async () => {
    appendEvents.mockResolvedValue({
      persisted: false,
      refusal: {
        resource: 'owner_redis_bytes',
        currentBytes: 33_000_000,
        limitBytes: 32 * 1024 * 1024,
        attemptedBytes: 4_096,
      },
    })

    const writer = new StreamWriter({
      streamId: 'stream-budget',
      chatId: 'chat-budget',
      requestId: 'req-budget',
      userId: 'user-budget',
    })

    const chunks: string[] = []
    writer.attach({
      enqueue: vi.fn((value: Uint8Array) => {
        chunks.push(decodeChunk(value))
      }),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController)

    writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'one' },
    } as StreamEvent)

    await expect(writer.flush()).resolves.toBeUndefined()
    expect(writer.persistenceStopped).toBe(true)

    // The turn keeps streaming; only the replay copy stopped.
    appendEvents.mockClear()
    writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'two' },
    } as StreamEvent)
    await writer.flush()

    expect(appendEvents).not.toHaveBeenCalled()
    expect(chunks.join('')).toContain('"text":"two"')
  })

  it('charges the replay buffer to the user when one is known', async () => {
    const writer = new StreamWriter({
      streamId: 'stream-1',
      chatId: 'chat-1',
      requestId: 'req-1',
      userId: 'user-7',
    })
    writer.attach({
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController)

    writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'x' },
    } as StreamEvent)
    await writer.flush()

    expect(appendEvents).toHaveBeenCalledWith(expect.any(Array), {
      streamId: 'stream-1',
      userId: 'user-7',
    })
  })

  it('does not persist a batch queued while an earlier append was already refusing', async () => {
    vi.useFakeTimers()
    let releaseFirst: () => void = () => {}
    appendEvents
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () =>
              resolve({
                persisted: false,
                refusal: {
                  resource: 'owner_redis_bytes',
                  currentBytes: 1,
                  limitBytes: 1,
                  attemptedBytes: 1,
                },
              })
          })
      )
      .mockResolvedValue({ persisted: true })

    const writer = new StreamWriter({
      streamId: 'stream-1',
      chatId: 'chat-1',
      requestId: 'req-1',
    })
    const controller = {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController
    writer.attach(controller)

    await writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'one' },
    })
    await vi.advanceTimersByTimeAsync(15)

    // Queued while the first append is still in flight, so the enqueue-time check cannot see the
    // refusal about to latch. Persisting it would leave replay holding a later event but not the
    // refused one — a hole a resuming client cannot detect.
    await writer.publish({
      type: MothershipStreamV1EventType.text,
      payload: { channel: MothershipStreamV1TextChannel.assistant, text: 'two' },
    })
    await vi.advanceTimersByTimeAsync(15)

    releaseFirst()
    await writer.close()

    expect(writer.persistenceStopped).toBe(true)
    expect(appendEvents).toHaveBeenCalledTimes(1)
  })
})
