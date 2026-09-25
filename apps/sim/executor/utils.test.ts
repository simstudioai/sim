import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StreamingResponseFormatProcessor } from '@/executor/utils'

describe('StreamingResponseFormatProcessor', () => {
  let processor: StreamingResponseFormatProcessor

  beforeEach(() => {
    processor = new StreamingResponseFormatProcessor()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('processStream', () => {
    it.concurrent('should process stream and extract single selected field', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"username": "alice", "age": 25}'))
          controller.close()
        },
      })

      const processedStream = processor.processStream(mockStream, 'block-1', ['block-1_username'], {
        schema: { properties: { username: { type: 'string' }, age: { type: 'number' } } },
      })

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('alice')
    })

    it.concurrent('should handle non-string field values by JSON stringifying them', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              '{"config": {"theme": "dark", "notifications": true}, "count": 42}'
            )
          )
          controller.close()
        },
      })

      const processedStream = processor.processStream(
        mockStream,
        'block-1',
        ['block-1_config', 'block-1_count'],
        {
          schema: { properties: { config: { type: 'object' }, count: { type: 'number' } } },
        }
      )

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('{"theme":"dark","notifications":true}\n42')
    })

    it.concurrent('should handle streaming JSON that comes in chunks', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          // Simulate streaming JSON in chunks
          controller.enqueue(new TextEncoder().encode('{"username": "charlie"'))
          controller.enqueue(new TextEncoder().encode(', "age": 35}'))
          controller.close()
        },
      })

      const processedStream = processor.processStream(mockStream, 'block-1', ['block-1_username'], {
        schema: { properties: { username: { type: 'string' }, age: { type: 'number' } } },
      })

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('charlie')
    })

    it.concurrent('should handle invalid JSON gracefully', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('invalid json'))
          controller.close()
        },
      })

      const processedStream = processor.processStream(mockStream, 'block-1', ['block-1_username'], {
        schema: { properties: { username: { type: 'string' } } },
      })

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('')
    })

    it.concurrent('should filter selected fields for correct block ID', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"username": "eve", "age": 28}'))
          controller.close()
        },
      })

      const processedStream = processor.processStream(
        mockStream,
        'block-1',
        ['block-1_username', 'block-2_age'], // Different block ID should be filtered out
        { schema: { properties: { username: { type: 'string' }, age: { type: 'number' } } } }
      )

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('eve')
    })
  })
})
