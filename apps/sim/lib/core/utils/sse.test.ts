import { describe, expect, it, vi } from 'vitest'
import { encodeSSE, readSSEEvents, readSSELines, readSSEStream } from '@/lib/core/utils/sse'

function createStreamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index])
        index++
      } else {
        controller.close()
      }
    },
  })
}

function createSSEChunk(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

describe('encodeSSE', () => {
  it.concurrent('should encode data as SSE format', () => {
    const data = { chunk: 'hello' }
    const result = encodeSSE(data)
    const decoded = new TextDecoder().decode(result)
    expect(decoded).toBe('data: {"chunk":"hello"}\n\n')
  })
})

describe('readSSEStream', () => {
  it.concurrent('should accumulate content from chunks', async () => {
    const chunks = [
      createSSEChunk({ chunk: 'Hello' }),
      createSSEChunk({ chunk: ' World' }),
      createSSEChunk({ done: true }),
    ]
    const stream = createStreamFromChunks(chunks)

    const result = await readSSEStream(stream)
    expect(result).toBe('Hello World')
  })

  it.concurrent('should call onAccumulated callback with accumulated content', async () => {
    const onAccumulated = vi.fn()
    const chunks = [createSSEChunk({ chunk: 'A' }), createSSEChunk({ chunk: 'B' })]
    const stream = createStreamFromChunks(chunks)

    await readSSEStream(stream, { onAccumulated })

    expect(onAccumulated).toHaveBeenCalledTimes(2)
    expect(onAccumulated).toHaveBeenNthCalledWith(1, 'A')
    expect(onAccumulated).toHaveBeenNthCalledWith(2, 'AB')
  })

  it.concurrent('should skip [DONE] messages', async () => {
    const encoder = new TextEncoder()
    const chunks = [createSSEChunk({ chunk: 'content' }), encoder.encode('data: [DONE]\n\n')]
    const stream = createStreamFromChunks(chunks)

    const result = await readSSEStream(stream)
    expect(result).toBe('content')
  })

  it.concurrent('should skip lines with error field', async () => {
    const chunks = [
      createSSEChunk({ error: 'Something went wrong' }),
      createSSEChunk({ chunk: 'valid content' }),
    ]
    const stream = createStreamFromChunks(chunks)

    const result = await readSSEStream(stream)
    expect(result).toBe('valid content')
  })

  it.concurrent('should handle abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const chunks = [createSSEChunk({ chunk: 'content' })]
    const stream = createStreamFromChunks(chunks)

    const result = await readSSEStream(stream, { signal: controller.signal })
    expect(result).toBe('')
  })

  it.concurrent('should skip unparseable lines', async () => {
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('data: invalid-json\n\n'), createSSEChunk({ chunk: 'valid' })]
    const stream = createStreamFromChunks(chunks)

    const result = await readSSEStream(stream)
    expect(result).toBe('valid')
  })

  describe('multi-byte UTF-8 character handling', () => {
    it.concurrent('should handle mixed multi-byte content split at byte boundaries', async () => {
      const text = 'Ö is Turkish, 中 is Chinese, 🎉 is emoji'
      const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
      const bytes = new TextEncoder().encode(fullData)

      const chunks: Uint8Array[] = []
      for (let i = 0; i < bytes.length; i += 3) {
        chunks.push(bytes.slice(i, Math.min(i + 3, bytes.length)))
      }

      const stream = createStreamFromChunks(chunks)
      const result = await readSSEStream(stream)
      expect(result).toBe(text)
    })

    it.concurrent(
      'should handle 4-byte UTF-8 character (🚀) split at byte boundaries',
      async () => {
        const text = 'A🚀B'
        const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
        const bytes = new TextEncoder().encode(fullData)

        const textStart = fullData.indexOf('"') + 1 + text.indexOf('🚀')
        const byteOffset = new TextEncoder().encode(fullData.slice(0, textStart)).length

        const chunk1 = bytes.slice(0, byteOffset + 1)
        const chunk2 = bytes.slice(byteOffset + 1, byteOffset + 2)
        const chunk3 = bytes.slice(byteOffset + 2, byteOffset + 3)
        const chunk4 = bytes.slice(byteOffset + 3)

        const stream = createStreamFromChunks([chunk1, chunk2, chunk3, chunk4])
        const result = await readSSEStream(stream)
        expect(result).toBe(text)
      }
    )
  })

  describe('SSE message buffering', () => {
    it.concurrent('should handle incomplete SSE message waiting for more data', async () => {
      const encoder = new TextEncoder()

      const chunk1 = encoder.encode('data: {"chu')
      const chunk2 = encoder.encode('nk":"hello"}\n\n')

      const stream = createStreamFromChunks([chunk1, chunk2])
      const result = await readSSEStream(stream)
      expect(result).toBe('hello')
    })

    it.concurrent('should handle multiple complete messages in one chunk', async () => {
      const encoder = new TextEncoder()

      const multiMessage = 'data: {"chunk":"A"}\n\ndata: {"chunk":"B"}\n\ndata: {"chunk":"C"}\n\n'
      const chunk = encoder.encode(multiMessage)

      const stream = createStreamFromChunks([chunk])
      const result = await readSSEStream(stream)
      expect(result).toBe('ABC')
    })
  })
})

function streamFromStringChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return createStreamFromChunks(chunks.map((c) => encoder.encode(c)))
}

describe('readSSEEvents', () => {
  it('parses `\\n\\n`-framed events', async () => {
    const stream = streamFromStringChunks([
      'data: {"n":1}\n\n',
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1, 2, 3])
  })

  it('parses `\\n`-framed events', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\ndata: {"n":2}\ndata: {"n":3}\n'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1, 2, 3])
  })

  it('reassembles events split across chunk boundaries', async () => {
    const stream = streamFromStringChunks(['data: {"ms', 'g":"hel', 'lo"}\n\n'])
    const events: Array<{ msg: string }> = []
    await readSSEEvents<{ msg: string }>(stream, {
      onEvent: (e) => {
        events.push(e)
      },
    })
    expect(events).toEqual([{ msg: 'hello' }])
  })

  it('emits a final data: line that has no trailing newline (stream tail)', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\n', 'data: {"n":2}'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1, 2])
  })

  it('flushes a multi-byte character in the final unterminated line', async () => {
    const encoder = new TextEncoder()
    const euro = encoder.encode('€')
    const chunk1 = new Uint8Array([...encoder.encode('data: {"s":"'), euro[0], euro[1]])
    const chunk2 = new Uint8Array([euro[2], ...encoder.encode('"}')])
    const stream = createStreamFromChunks([chunk1, chunk2])
    const events: Array<{ s: string }> = []
    await readSSEEvents<{ s: string }>(stream, {
      onEvent: (e) => {
        events.push(e)
      },
    })
    expect(events).toEqual([{ s: '€' }])
  })

  it('routes unparseable payloads to onParseError and continues', async () => {
    const stream = streamFromStringChunks(['data: not-json\n\n', 'data: {"n":2}\n\n'])
    const events: number[] = []
    const onParseError = vi.fn()
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
      onParseError,
    })
    expect(events).toEqual([2])
    expect(onParseError).toHaveBeenCalledTimes(1)
    expect(onParseError).toHaveBeenCalledWith('not-json', expect.any(Error))
  })

  it('accepts a Response source', async () => {
    const response = new Response(streamFromStringChunks(['data: {"n":7}\n\n']))
    const events: number[] = []
    await readSSEEvents<{ n: number }>(response, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([7])
  })

  it('surfaces a fatal parse error when onParseError throws', async () => {
    const stream = streamFromStringChunks(['data: not-json\n\n', 'data: {"n":2}\n\n'])
    const events: number[] = []
    await expect(
      readSSEEvents<{ n: number }>(stream, {
        onEvent: (e) => {
          events.push(e.n)
        },
        onParseError: () => {
          throw new Error('boom')
        },
      })
    ).rejects.toThrow('boom')
    expect(events).toEqual([])
  })

  it('throws "No response body" for a Response without a body', async () => {
    const response = new Response(null)
    await expect(readSSEEvents(response, { onEvent: () => {} })).rejects.toThrow('No response body')
  })
})

describe('readSSELines', () => {
  it('rejects a silent open connection and cancels its reader without waiting for cancellation', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const reader = new ReadableStream<Uint8Array>({ cancel }).getReader()
    const rejected = vi.fn()
    const reading = readSSELines(reader, { onData: vi.fn(), idleTimeoutMs: 45_000 }).catch(rejected)
    try {
      await vi.advanceTimersByTimeAsync(45_000)
      expect(rejected).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SSEIdleTimeoutError' })
      )
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      void reader.cancel()
      await reading
      vi.useRealTimers()
    }
  })

  it('counts keepalive comments as activity while a long tool is running', async () => {
    vi.useFakeTimers()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value
      },
    })
    const onData = vi.fn()
    const rejected = vi.fn()
    const reading = readSSELines(stream, { onData, idleTimeoutMs: 45_000 }).catch(rejected)
    try {
      for (let heartbeat = 0; heartbeat < 6; heartbeat++) {
        await vi.advanceTimersByTimeAsync(15_000)
        controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(rejected).not.toHaveBeenCalled()
      expect(onData).not.toHaveBeenCalled()
      controller.enqueue(new TextEncoder().encode('data: tool finished\n\n'))
      controller.close()
      await reading
      expect(onData).toHaveBeenCalledWith('tool finished')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips [DONE] and blank separator lines', async () => {
    const stream = streamFromStringChunks(['data: a\n\ndata: b\n\ndata: [DONE]\n\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      onData: (raw) => {
        lines.push(raw)
      },
    })
    expect(lines).toEqual(['a', 'b'])
  })

  it('preserves the raw payload verbatim (no JSON parsing)', async () => {
    const stream = streamFromStringChunks(['data: {"unterminated\n\n', 'data:no-space\n\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      onData: (raw) => {
        lines.push(raw)
      },
    })
    expect(lines).toEqual(['{"unterminated', 'no-space'])
  })

  it('strips a trailing carriage return from each line', async () => {
    const stream = streamFromStringChunks(['data: one\r\n\r\ndata: two\r\n\r\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      onData: (raw) => {
        lines.push(raw)
      },
    })
    expect(lines).toEqual(['one', 'two'])
  })

  it('stops early when onData returns true', async () => {
    const stream = streamFromStringChunks(['data: a\n\ndata: b\n\ndata: c\n\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      onData: (raw) => {
        lines.push(raw)
        return raw === 'b'
      },
    })
    expect(lines).toEqual(['a', 'b'])
  })

  it('does not deliver any line when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const stream = streamFromStringChunks(['data: a\n\n'])
    const onData = vi.fn()
    await readSSELines(stream, { signal: controller.signal, onData })
    expect(onData).not.toHaveBeenCalled()
  })

  it('stops between events in the same chunk once aborted mid-stream', async () => {
    const controller = new AbortController()
    const stream = streamFromStringChunks(['data: a\n\ndata: b\n\ndata: c\n\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      signal: controller.signal,
      onData: (raw) => {
        lines.push(raw)
        if (raw === 'a') controller.abort()
      },
    })
    expect(lines).toEqual(['a'])
  })

  it('releases the lock for a stream source', async () => {
    const stream = streamFromStringChunks(['data: a\n\n'])
    await readSSELines(stream, { onData: () => {} })
    expect(() => stream.getReader()).not.toThrow()
  })

  it('does not release the lock for a reader source', async () => {
    const stream = streamFromStringChunks(['data: a\n\n'])
    const reader = stream.getReader()
    await readSSELines(reader, { onData: () => {} })
    expect(() => stream.getReader()).toThrow()
    reader.releaseLock()
  })

  it('releases the lock for a stream source even when onData throws', async () => {
    const stream = streamFromStringChunks(['data: a\n\n'])
    await expect(
      readSSELines(stream, {
        onData: () => {
          throw new Error('handler failed')
        },
      })
    ).rejects.toThrow('handler failed')
    expect(() => stream.getReader()).not.toThrow()
  })
})
