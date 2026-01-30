/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { encodeSSE, readSSEStream, SSE_HEADERS } from '@/lib/core/utils/sse'

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
