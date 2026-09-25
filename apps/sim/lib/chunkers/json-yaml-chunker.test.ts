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

  describe('chunkStructured', () => {
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
  })

  describe('edge cases', () => {
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
  })
})
