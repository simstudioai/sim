import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StreamingResponseFormatProcessor,
  streamingResponseFormatProcessor,
} from '@/executor/utils'

vi.mock('@/lib/logs/console-logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('StreamingResponseFormatProcessor', () => {
  let processor: StreamingResponseFormatProcessor

  beforeEach(() => {
    processor = new StreamingResponseFormatProcessor()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('processStream', () => {
    it.concurrent('should return original stream when no response format selection', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"content": "test"}'))
          controller.close()
        },
      })

      const result = processor.processStream(
        mockStream,
        'block-1',
        ['block-1.content'], // No underscore, not response format
        { schema: { properties: { username: { type: 'string' } } } }
      )

      expect(result).toBe(mockStream)
    })

    it.concurrent('should return original stream when no response format provided', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"content": "test"}'))
          controller.close()
        },
      })

      const result = processor.processStream(
        mockStream,
        'block-1',
        ['block-1_username'], // Has underscore but no response format
        undefined
      )

      expect(result).toBe(mockStream)
    })

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

    it.concurrent('should process stream and extract multiple selected fields', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('{"username": "bob", "age": 30, "email": "bob@test.com"}')
          )
          controller.close()
        },
      })

      const processedStream = processor.processStream(
        mockStream,
        'block-1',
        ['block-1_username', 'block-1_age'],
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

      expect(result).toBe('bob\n30')
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
        { schema: { properties: { config: { type: 'object' }, count: { type: 'number' } } } }
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

    it.concurrent('should handle missing fields gracefully', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"username": "diana"}'))
          controller.close()
        },
      })

      const processedStream = processor.processStream(
        mockStream,
        'block-1',
        ['block-1_username', 'block-1_missing_field'],
        { schema: { properties: { username: { type: 'string' } } } }
      )

      const reader = processedStream.getReader()
      const decoder = new TextDecoder()
      let result = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        result += decoder.decode(value)
      }

      expect(result).toBe('diana')
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

    it.concurrent('should handle empty result when no matching fields', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"other_field": "value"}'))
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
  })

  describe('singleton instance', () => {
    it.concurrent('should export a singleton instance', () => {
      expect(streamingResponseFormatProcessor).toBeInstanceOf(StreamingResponseFormatProcessor)
    })

    it.concurrent('should return the same instance on multiple imports', () => {
      const instance1 = streamingResponseFormatProcessor
      const instance2 = streamingResponseFormatProcessor
      expect(instance1).toBe(instance2)
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle empty stream', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
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

    it.concurrent('should handle very large JSON objects', async () => {
      const largeObject = {
        username: 'frank',
        data: 'x'.repeat(10000), // Large string
        nested: {
          deep: {
            value: 'test',
          },
        },
      }

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(largeObject)))
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

      expect(result).toBe('frank')
    })
  })
})
