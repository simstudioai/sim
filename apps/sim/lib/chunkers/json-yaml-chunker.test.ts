/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { JsonYamlChunker } from '@/lib/chunkers/json-yaml-chunker'

vi.mock('@/lib/tokenization', () => ({
  getAccurateTokenCount: (text: string) => Math.ceil(text.length / 4),
}))

vi.mock('@/lib/tokenization/estimators', () => ({
  estimateTokenCount: (text: string) => ({ count: Math.ceil(text.length / 4) }),
}))

describe('JsonYamlChunker', () => {
  it.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])('rejects an invalid chunk size at construction: %s', (chunkSize) => {
    expect(() => new JsonYamlChunker({ chunkSize })).toThrow(
      'JSON/YAML chunk size must be a finite number between 1'
    )
  })

  it('normalizes a fractional legacy chunk size to its integer token ceiling', async () => {
    const chunks = await new JsonYamlChunker({ chunkSize: 100.5, minCharactersPerChunk: 1 }).chunk(
      JSON.stringify({ value: 'x'.repeat(1_000) })
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.tokenCount <= 100)).toBe(true)
  })

  describe('chunkStructured', () => {
    it('chunks valid JSON', async () => {
      await expect(JsonYamlChunker.chunkStructured('{"key": "value"}')).resolves.not.toBeNull()
    })

    it('chunks a valid JSON array', async () => {
      await expect(JsonYamlChunker.chunkStructured('[1, 2, 3]')).resolves.not.toBeNull()
    })

    it('chunks valid YAML', async () => {
      await expect(
        JsonYamlChunker.chunkStructured('key: value\nother: data')
      ).resolves.not.toBeNull()
    })

    it('declines plain text that parses as a YAML scalar', async () => {
      await expect(
        JsonYamlChunker.chunkStructured('Hello, this is plain text.')
      ).resolves.toBeNull()
    })

    it('declines invalid JSON/YAML with unbalanced braces', async () => {
      await expect(
        JsonYamlChunker.chunkStructured('{invalid: json: content: {{')
      ).resolves.toBeNull()
    })

    it('chunks nested JSON objects', async () => {
      const nested = JSON.stringify({ level1: { level2: { level3: 'value' } } })
      await expect(JsonYamlChunker.chunkStructured(nested)).resolves.not.toBeNull()
    })

    it('declines an alias-expansion bomb instead of expanding it', async () => {
      const lines = ['a0: &a0 "lol"']
      for (let level = 1; level <= 7; level++) {
        lines.push(
          `a${level}: &a${level} [${Array(7)
            .fill(`*a${level - 1}`)
            .join(',')}]`
        )
      }
      lines.push('top: *a7')
      const bomb = lines.join('\n')

      const chunks = await JsonYamlChunker.chunkStructured(bomb, {
        chunkSize: 1024,
        minCharactersPerChunk: 1,
        maxChunks: 5000,
      })

      expect(chunks).toBeNull()
    })

    it('never parses source larger than one output budget', async () => {
      const oversized = JSON.stringify({ value: 'x'.repeat(5 * 1024 * 1024) })
      const parse = vi.spyOn(JSON, 'parse')

      try {
        await expect(
          JsonYamlChunker.chunkStructured(oversized, {
            chunkSize: 1024,
            minCharactersPerChunk: 1,
            maxChunks: 1024,
          })
        ).resolves.toBeNull()
        expect(parse).not.toHaveBeenCalled()
      } finally {
        parse.mockRestore()
      }
    })

    it('chunks with default options', async () => {
      const chunks = await JsonYamlChunker.chunkStructured(JSON.stringify({ test: 'value' }))

      expect(chunks?.length).toBeGreaterThan(0)
    })

    it('honors a custom chunk size', async () => {
      const largeObject: Record<string, string> = {}
      for (let i = 0; i < 50; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(20)
      }
      const json = JSON.stringify(largeObject)

      const chunksSmall = await JsonYamlChunker.chunkStructured(json, { chunkSize: 50 })
      const chunksLarge = await JsonYamlChunker.chunkStructured(json, { chunkSize: 500 })

      expect(chunksSmall).not.toBeNull()
      expect(chunksLarge).not.toBeNull()
      expect(chunksSmall?.length).toBeGreaterThan(chunksLarge?.length as number)
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
      const invalidJson = `{this is not valid json: content: {{${' more content here '.repeat(10)}`
      const chunks = await chunker.chunk(invalidJson)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should fall back to bounded text chunking when YAML traversal fails', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 1000, minCharactersPerChunk: 1 })
      const cyclicYaml = ['root: &root', '  value: readable', '  self: *root'].join('\n')

      const chunks = await chunker.chunk(cyclicYaml)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('&root')
      expect(chunks[0].text).toContain('readable')
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
      expect(chunks.every((chunk) => chunk.tokenCount <= 100)).toBe(true)
    })

    it('splits a long single-line scalar to the configured chunk size', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 1024, minCharactersPerChunk: 1 })
      const json = JSON.stringify({ value: `START-${'x'.repeat(32_755)}-END` })

      const chunks = await chunker.chunk(json)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(chunks.some((chunk) => chunk.text.includes('START-'))).toBe(true)
      expect(chunks.some((chunk) => chunk.text.includes('-END'))).toBe(true)
    })

    it('splits a long scalar nested beyond the structured traversal depth', async () => {
      const chunker = new JsonYamlChunker({ chunkSize: 1024, minCharactersPerChunk: 1 })
      let nested: unknown = `START-${'x'.repeat(40_000)}-END`
      for (let depth = 0; depth < 6; depth++) nested = [nested]

      const chunks = await chunker.chunk(JSON.stringify(nested))

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(chunks.some((chunk) => chunk.text.includes('START-'))).toBe(true)
      expect(chunks.some((chunk) => chunk.text.includes('-END'))).toBe(true)
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

  describe('chunk metadata', () => {
    it('preserves every source character and offset when bounding oversized chunks', async () => {
      const key = 'p'.repeat(80)
      const value = { value: 'alpha beta gamma' }
      const expectedText = `// ${key}\n${JSON.stringify(value, null, 2)}`
      const chunker = new JsonYamlChunker({ chunkSize: 10, minCharactersPerChunk: 1 })

      const chunks = await chunker.chunk(JSON.stringify({ [key]: value }))

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(expectedText.slice(chunk.metadata.startIndex, chunk.metadata.endIndex)).toBe(
          chunk.text
        )
      }
      expect(chunks.map((chunk) => chunk.text).join('')).toBe(expectedText)
    })

    it('preserves spaces inside an oversized scalar line', async () => {
      const content = JSON.stringify('AAAAAA   BBBBBB')
      const chunker = new JsonYamlChunker({ chunkSize: 2, minCharactersPerChunk: 1 })

      const chunks = await chunker.chunk(content)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 2)).toBe(true)
      expect(chunks.map((chunk) => chunk.text).join('')).toBe(content)
      for (const chunk of chunks) {
        expect(content.slice(chunk.metadata.startIndex, chunk.metadata.endIndex)).toBe(chunk.text)
      }
    })

    it('preserves array item ranges when batch formatting requires bounded splits', async () => {
      const values = ['x0', 'x1', 'x2', 'x3']
      const chunker = new JsonYamlChunker({ chunkSize: 2, minCharactersPerChunk: 1 })

      const chunks = await chunker.chunk(JSON.stringify(values))

      expect(new Set(chunks.map((chunk) => JSON.stringify(chunk.metadata)))).toEqual(
        new Set([
          JSON.stringify({ startIndex: 0, endIndex: 1 }),
          JSON.stringify({ startIndex: 2, endIndex: 3 }),
        ])
      )
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(2)
      }
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 0)
          .map((chunk) => chunk.text)
          .join(' ')
      ).toContain('x0')
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 2)
          .map((chunk) => chunk.text)
          .join(' ')
      ).toContain('x2')
    })

    it('preserves the item range when an oversized array item is split', async () => {
      const oversizedItem = 'alpha beta gamma delta epsilon zeta eta theta'
      const chunker = new JsonYamlChunker({ chunkSize: 5, minCharactersPerChunk: 1 })

      const chunks = await chunker.chunk(JSON.stringify([oversizedItem, 'short']))

      expect(chunks.filter((chunk) => chunk.metadata.startIndex === 0).length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 5)).toBe(true)
      expect(new Set(chunks.map((chunk) => JSON.stringify(chunk.metadata)))).toEqual(
        new Set([
          JSON.stringify({ startIndex: 0, endIndex: 0 }),
          JSON.stringify({ startIndex: 1, endIndex: 1 }),
        ])
      )
    })

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

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text.length).toBeGreaterThan(0)
    })
  })
})
