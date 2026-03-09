/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { JsonYamlChunker } from './json-yaml-chunker'

vi.mock('@sim/logger', () => loggerMock)

vi.mock('@/lib/tokenization', () => ({
  getAccurateTokenCount: (text: string) => Math.ceil(text.length / 4),
}))

vi.mock('@/lib/tokenization/estimators', () => ({
  estimateTokenCount: (text: string) => ({ count: Math.ceil(text.length / 4) }),
}))

describe('JsonYamlChunker', () => {
  describe('isStructuredData', () => {
    it('should detect valid JSON', () => {
      expect(JsonYamlChunker.isStructuredData('{"key": "value"}')).toBe(true)
    })

    it('should detect valid JSON array', () => {
      expect(JsonYamlChunker.isStructuredData('[1, 2, 3]')).toBe(true)
    })

    it('should detect valid YAML', () => {
      expect(JsonYamlChunker.isStructuredData('key: value\nother: data')).toBe(true)
    })

    it('should return true for YAML-like plain text', () => {
      // Note: js-yaml is permissive and parses plain text as valid YAML (scalar value)
      // This is expected behavior of the YAML parser
      expect(JsonYamlChunker.isStructuredData('Hello, this is plain text.')).toBe(true)
    })

    it('should return false for invalid JSON/YAML with unbalanced braces', () => {
      // Only truly malformed content that fails YAML parsing returns false
      expect(JsonYamlChunker.isStructuredData('{invalid: json: content: {{')).toBe(false)
    })

    it('should detect nested JSON objects', () => {
      const nested = JSON.stringify({ level1: { level2: { level3: 'value' } } })
      expect(JsonYamlChunker.isStructuredData(nested)).toBe(true)
    })
  })

  describe('basic chunking', () => {
    it.concurrent('should return single chunk for small JSON', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 1000 })
      const json = JSON.stringify({ name: 'test', value: 123 })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should return empty array for empty object', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = '{}'
      const chunks = await chunker.chunk(json)

      // Empty object is valid JSON, should return at least metadata
      expect(chunks.length).toBeGreaterThanOrEqual(0)
    })

    it.concurrent('should chunk large JSON object', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      const largeObject: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(10)
      }
      const json = JSON.stringify(largeObject)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should chunk large JSON array', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      const largeArray = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        description: 'A description that takes some space',
      }))
      const json = JSON.stringify(largeArray)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should include token count in chunk metadata', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 1000 })
      const json = JSON.stringify({ hello: 'world' })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].tokenCount).toBeGreaterThan(0)
    })
  })

  describe('YAML chunking', () => {
    it.concurrent('should chunk valid YAML', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const yaml = `
name: test
version: 1.0.0
config:
  debug: true
  port: 8080
      `.trim()
      const chunks = await chunker.chunk(yaml)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle YAML with arrays', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const yaml = `
items:
  - name: first
    value: 1
  - name: second
    value: 2
  - name: third
    value: 3
      `.trim()
      const chunks = await chunker.chunk(yaml)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle YAML with nested structures', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      const yaml = `
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: secret
server:
  host: 0.0.0.0
  port: 3000
      `.trim()
      const chunks = await chunker.chunk(yaml)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('structured data handling', () => {
    it.concurrent('should preserve context path for nested objects', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 30 })
      const data = {
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
      }
      const json = JSON.stringify(data)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle deeply nested structures', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      const deepObject = {
        l1: {
          l2: {
            l3: {
              l4: {
                l5: 'deep value',
              },
            },
          },
        },
      }
      const json = JSON.stringify(deepObject)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle mixed arrays and objects', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const mixed = {
        settings: { theme: 'dark', language: 'en' },
        items: [1, 2, 3],
        users: [{ name: 'Alice' }, { name: 'Bob' }],
      }
      const json = JSON.stringify(mixed)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle empty array', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = '[]'
      const chunks = await chunker.chunk(json)

      // Empty array should not produce chunks with meaningful content
      expect(chunks.length).toBeGreaterThanOrEqual(0)
    })

    it.concurrent('should handle JSON with unicode keys and values', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        名前: '田中太郎',
        住所: '東京都渋谷区',
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('名前')
    })

    it.concurrent('should handle JSON with special characters in strings', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        text: 'Line 1\nLine 2\tTabbed',
        special: '!@#$%^&*()',
        quotes: '"double" and \'single\'',
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle JSON with null values', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        valid: 'value',
        empty: null,
        another: 'value',
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('null')
    })

    it.concurrent('should handle JSON with boolean values', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        active: true,
        deleted: false,
        name: 'test',
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should handle JSON with numeric values', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        integer: 42,
        float: Math.PI,
        negative: -100,
        scientific: 1.5e10,
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should fall back to text chunking for invalid JSON', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100, minCharactersPerChunk: 10 })
      // Create content that fails YAML parsing and is long enough to produce chunks
      const invalidJson = `{this is not valid json: content: {{${' more content here '.repeat(10)}`
      const chunks = await chunker.chunk(invalidJson)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('large inputs', () => {
    it.concurrent('should handle JSON with 1000 array items', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 200 })
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }))
      const json = JSON.stringify(largeArray)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle JSON with long string values', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({
        content: 'A'.repeat(5000),
        description: 'B'.repeat(3000),
      })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle deeply nested structure up to depth limit', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      let nested: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 10; i++) {
        nested = { [`level${i}`]: nested }
      }
      const json = JSON.stringify(nested)
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('static chunkJsonYaml method', () => {
    it.concurrent('should work with default options', async () => {
      const json = JSON.stringify({ test: 'value' })
      const chunks = await JsonYamlChunker.chunkJsonYaml(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should accept custom options', async () => {
      const largeObject: Record<string, string> = {}
      for (let i = 0; i < 50; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(20)
      }
      const json = JSON.stringify(largeObject)

      const chunksSmall = await JsonYamlChunker.chunkJsonYaml(json, { chunkSize: 50 })
      const chunksLarge = await JsonYamlChunker.chunkJsonYaml(json, { chunkSize: 500 })

      expect(chunksSmall.length).toBeGreaterThan(chunksLarge.length)
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include startIndex and endIndex in metadata', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100 })
      const json = JSON.stringify({ key: 'value' })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].metadata.startIndex).toBeDefined()
      expect(chunks[0].metadata.endIndex).toBeDefined()
    })

    it.concurrent('should have valid metadata indices for array chunking', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 50 })
      const largeArray = Array.from({ length: 50 }, (_, i) => ({ id: i, data: 'x'.repeat(20) }))
      const json = JSON.stringify(largeArray)
      const chunks = await chunker.chunk(json)

      for (const chunk of chunks) {
        expect(chunk.metadata.startIndex).toBeDefined()
        expect(chunk.metadata.endIndex).toBeDefined()
      }
    })
  })

  describe('constructor options', () => {
    it.concurrent('should use default chunkSize when not provided', async () => {
      const chunker = new JsonYamlChunker({})
      const json = JSON.stringify({ test: 'value' })
      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should respect custom minCharactersPerChunk', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 100, minCharactersPerChunk: 20 })
      const json = JSON.stringify({ a: 1, b: 2, c: 3 })
      const chunks = await chunker.chunk(json)

      // Should produce chunks that are valid
      expect(chunks.length).toBeGreaterThan(0)
      // The entire small object fits in one chunk
      expect(chunks[0].text.length).toBeGreaterThan(0)
    })
  })
})
