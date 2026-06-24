/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  encodeSSE,
  readSSEEvents,
  readSSELines,
  readSSEStream,
  SSE_HEADERS,
} from '@/lib/core/utils/sse'

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

describe('SSE_HEADERS', () => {
  it.concurrent('should have correct Content-Type', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream')
  })

  it.concurrent('should have correct Cache-Control', () => {
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache')
  })

  it.concurrent('should have Connection keep-alive', () => {
    expect(SSE_HEADERS.Connection).toBe('keep-alive')
  })

  it.concurrent('should disable buffering', () => {
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no')
  })
})

describe('encodeSSE', () => {
  it.concurrent('should encode data as SSE format', () => {
    const data = { chunk: 'hello' }
    const result = encodeSSE(data)
    const decoded = new TextDecoder().decode(result)
    expect(decoded).toBe('data: {"chunk":"hello"}\n\n')
  })

  it.concurrent('should handle complex objects', () => {
    const data = { chunk: 'test', nested: { value: 123 } }
    const result = encodeSSE(data)
    const decoded = new TextDecoder().decode(result)
    expect(decoded).toBe('data: {"chunk":"test","nested":{"value":123}}\n\n')
  })

  it.concurrent('should handle strings with special characters', () => {
    const data = { chunk: 'Hello, 世界! 🌍' }
    const result = encodeSSE(data)
    const decoded = new TextDecoder().decode(result)
    expect(decoded).toContain('Hello, 世界! 🌍')
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

  it.concurrent('should call onChunk callback for each chunk', async () => {
    const onChunk = vi.fn()
    const chunks = [createSSEChunk({ chunk: 'A' }), createSSEChunk({ chunk: 'B' })]
    const stream = createStreamFromChunks(chunks)

    await readSSEStream(stream, { onChunk })

    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(onChunk).toHaveBeenNthCalledWith(1, 'A')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'B')
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
    it.concurrent('should handle Turkish characters split across chunks', async () => {
      const text = 'Merhaba dünya! Öğretmen şarkı söyledi.'
      const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
      const bytes = new TextEncoder().encode(fullData)

      const splitPoint = Math.floor(bytes.length / 2)
      const chunk1 = bytes.slice(0, splitPoint)
      const chunk2 = bytes.slice(splitPoint)

      const stream = createStreamFromChunks([chunk1, chunk2])
      const result = await readSSEStream(stream)
      expect(result).toBe(text)
    })

    it.concurrent('should handle emoji split across chunks', async () => {
      const text = 'Hello 🚀 World 🌍 Test 🎯'
      const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
      const bytes = new TextEncoder().encode(fullData)

      const emojiIndex = fullData.indexOf('🚀')
      const byteOffset = new TextEncoder().encode(fullData.slice(0, emojiIndex)).length
      const splitPoint = byteOffset + 2

      const chunk1 = bytes.slice(0, splitPoint)
      const chunk2 = bytes.slice(splitPoint)

      const stream = createStreamFromChunks([chunk1, chunk2])
      const result = await readSSEStream(stream)
      expect(result).toBe(text)
    })

    it.concurrent('should handle CJK characters split across chunks', async () => {
      const text = '你好世界！日本語テスト。한국어도 됩니다.'
      const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
      const bytes = new TextEncoder().encode(fullData)

      const third = Math.floor(bytes.length / 3)
      const chunk1 = bytes.slice(0, third)
      const chunk2 = bytes.slice(third, third * 2)
      const chunk3 = bytes.slice(third * 2)

      const stream = createStreamFromChunks([chunk1, chunk2, chunk3])
      const result = await readSSEStream(stream)
      expect(result).toBe(text)
    })

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

    it.concurrent('should handle SSE message split across chunks', async () => {
      const encoder = new TextEncoder()
      const message1 = { chunk: 'First' }
      const message2 = { chunk: 'Second' }

      const fullText = `data: ${JSON.stringify(message1)}\n\ndata: ${JSON.stringify(message2)}\n\n`
      const bytes = encoder.encode(fullText)

      const delimiterIndex = fullText.indexOf('\n\n') + 1
      const byteOffset = encoder.encode(fullText.slice(0, delimiterIndex)).length

      const chunk1 = bytes.slice(0, byteOffset)
      const chunk2 = bytes.slice(byteOffset)

      const stream = createStreamFromChunks([chunk1, chunk2])
      const result = await readSSEStream(stream)
      expect(result).toBe('FirstSecond')
    })

    it.concurrent('should handle 2-byte UTF-8 character (Ö) split at byte boundary', async () => {
      const text = 'AÖB'
      const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
      const bytes = new TextEncoder().encode(fullData)

      const textStart = fullData.indexOf('"') + 1 + text.indexOf('Ö')
      const byteOffset = new TextEncoder().encode(fullData.slice(0, textStart)).length

      const chunk1 = bytes.slice(0, byteOffset + 1)
      const chunk2 = bytes.slice(byteOffset + 1)

      const stream = createStreamFromChunks([chunk1, chunk2])
      const result = await readSSEStream(stream)
      expect(result).toBe(text)
    })

    it.concurrent(
      'should handle 3-byte UTF-8 character (中) split at byte boundaries',
      async () => {
        const text = 'A中B'
        const fullData = `data: ${JSON.stringify({ chunk: text })}\n\n`
        const bytes = new TextEncoder().encode(fullData)

        const textStart = fullData.indexOf('"') + 1 + text.indexOf('中')
        const byteOffset = new TextEncoder().encode(fullData.slice(0, textStart)).length

        const chunk1 = bytes.slice(0, byteOffset + 1)
        const chunk2 = bytes.slice(byteOffset + 1, byteOffset + 2)
        const chunk3 = bytes.slice(byteOffset + 2)

        const stream = createStreamFromChunks([chunk1, chunk2, chunk3])
        const result = await readSSEStream(stream)
        expect(result).toBe(text)
      }
    )

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

    it.concurrent('should handle message that ends exactly at chunk boundary', async () => {
      const chunks = [createSSEChunk({ chunk: 'First' }), createSSEChunk({ chunk: 'Second' })]
      const stream = createStreamFromChunks(chunks)

      const result = await readSSEStream(stream)
      expect(result).toBe('FirstSecond')
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

  it('skips the [DONE] sentinel', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\n\n', 'data: [DONE]\n\n'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1])
  })

  it('accepts `data:` with and without a leading space', async () => {
    const stream = streamFromStringChunks(['data:{"n":1}\n\n', 'data: {"n":2}\n\n'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1, 2])
  })

  it('strips trailing carriage returns (\\r\\n framing)', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\r\n\r\n', 'data: {"n":2}\r\n\r\n'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
      },
    })
    expect(events).toEqual([1, 2])
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

  it('stops early when onEvent returns true', async () => {
    const stream = streamFromStringChunks([
      'data: {"n":1}\n\n',
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: (e) => {
        events.push(e.n)
        return e.n === 2
      },
    })
    expect(events).toEqual([1, 2])
  })

  it('does not process events once the signal is aborted', async () => {
    const controller = new AbortController()
    const stream = streamFromStringChunks(['data: {"n":1}\n\n', 'data: {"n":2}\n\n'])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      signal: controller.signal,
      onEvent: (e) => {
        events.push(e.n)
        controller.abort()
      },
    })
    expect(events).toEqual([1])
  })

  it('returns immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const stream = streamFromStringChunks(['data: {"n":1}\n\n'])
    const onEvent = vi.fn()
    await readSSEEvents(stream, { signal: controller.signal, onEvent })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('releases the reader lock for a stream source', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\n\n'])
    await readSSEEvents<{ n: number }>(stream, { onEvent: () => {} })
    expect(() => stream.getReader()).not.toThrow()
  })

  it('does not release the lock for a reader source', async () => {
    const stream = streamFromStringChunks(['data: {"n":1}\n\n'])
    const reader = stream.getReader()
    await readSSEEvents<{ n: number }>(reader, { onEvent: () => {} })
    expect(() => stream.getReader()).toThrow()
    reader.releaseLock()
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

  it('silently skips unparseable payloads when no onParseError is provided', async () => {
    const stream = streamFromStringChunks(['data: not-json\n\n', 'data: {"n":2}\n\n'])
    const events: number[] = []
    await expect(
      readSSEEvents<{ n: number }>(stream, {
        onEvent: (e) => {
          events.push(e.n)
        },
      })
    ).resolves.toBeUndefined()
    expect(events).toEqual([2])
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

  it('stops early when onEvent resolves true asynchronously', async () => {
    const stream = streamFromStringChunks([
      'data: {"n":1}\n\n',
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ])
    const events: number[] = []
    await readSSEEvents<{ n: number }>(stream, {
      onEvent: async (e) => {
        events.push(e.n)
        return e.n === 2
      },
    })
    expect(events).toEqual([1, 2])
  })

  it('throws "No response body" for a Response without a body', async () => {
    const response = new Response(null)
    await expect(readSSEEvents(response, { onEvent: () => {} })).rejects.toThrow('No response body')
  })
})

describe('readSSELines', () => {
  it('delivers raw (un-parsed) data payloads', async () => {
    const stream = streamFromStringChunks(['data: raw-one\n\n', 'data: {"keep":"asString"}\n\n'])
    const lines: string[] = []
    await readSSELines(stream, {
      onData: (raw) => {
        lines.push(raw)
      },
    })
    expect(lines).toEqual(['raw-one', '{"keep":"asString"}'])
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
