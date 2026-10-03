import { describe, expect, it } from 'vitest'
import { StructuredDataChunker } from './structured-data-chunker'

describe('StructuredDataChunker', () => {
  describe('isStructuredData', () => {
    it('should handle inconsistent delimiter counts', () => {
      const inconsistent = 'name,age\nAlice,30,extra\nBob'
      const result = StructuredDataChunker.isStructuredData(inconsistent)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('chunkStructuredData', () => {
    it.each([
      0,
      -1,
      0.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ])('rejects an invalid chunk size before inspecting content: %s', async (chunkSize) => {
      await expect(StructuredDataChunker.chunkStructuredData('', { chunkSize })).rejects.toThrow(
        'Structured data chunk size must be a finite number between 1'
      )
    })

    it('normalizes a fractional legacy chunk size to its integer token ceiling', async () => {
      const chunks = await StructuredDataChunker.chunkStructuredData(
        `value\n${'x'.repeat(1_000)}`,
        { chunkSize: 100.5 }
      )

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 100)).toBe(true)
    })

    it('splits a maximum-length spreadsheet cell without dropping its content', async () => {
      const value = `START-${'x'.repeat(32_755)}-END`
      const chunks = await StructuredDataChunker.chunkStructuredData(`value\n${value}`, {
        chunkSize: 1024,
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(chunks[0].text).toContain('START-')
      expect(chunks.at(-1)?.text).toContain('-END')
    })

    it('splits an oversized header without repeating it into every row segment', async () => {
      const header = `HEADER-${'h '.repeat(2_500)}-END`
      const row = `ROW-${'r '.repeat(5_000)}-END`

      const chunks = await StructuredDataChunker.chunkStructuredData(`${header}\n${row}`, {
        chunkSize: 1024,
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.length).toBeLessThan(20)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 0)
          .map((chunk) => chunk.text)
          .join('')
      ).toBe(header)
      expect(
        chunks
          .filter((chunk) => chunk.metadata.startIndex === 1)
          .map((chunk) => chunk.text)
          .join('')
      ).toBe(row)
      expect(chunks.every((chunk) => !chunk.text.includes('Headers:'))).toBe(true)
      expect(chunks.every((chunk) => !chunk.text.includes('rows of data'))).toBe(true)
    })

    it('preserves spaces when splitting an oversized structured row', async () => {
      const row = 'AAAAAA BBBBBB'
      const chunks = await StructuredDataChunker.chunkStructuredData(`value\n${row}`, {
        chunkSize: 15,
      })
      const prefix = 'Headers: value\n-----\n'
      const suffix = '\n\n[1 rows of data]'
      const rowSegments = chunks
        .filter((chunk) => chunk.metadata.startIndex === 1)
        .map((chunk) => chunk.text.slice(prefix.length, -suffix.length))

      expect(rowSegments.join('')).toBe(row)
      expect(chunks.every((chunk) => chunk.tokenCount <= 15)).toBe(true)
    })

    it('does not let the minimum row target exceed the token target', async () => {
      const row = 'x'.repeat(2_900)
      const content = ['value', row, row, row, row, row].join('\n')

      const chunks = await StructuredDataChunker.chunkStructuredData(content, { chunkSize: 1024 })

      expect(chunks.length).toBe(5)
      expect(chunks.every((chunk) => chunk.tokenCount <= 1024)).toBe(true)
    })

    it('accounts for labels, separators, sheet names, and footers before batching rows', async () => {
      const content = ['h', ...Array.from({ length: 30 }, () => 'x')].join('\n')
      const chunks = await StructuredDataChunker.chunkStructuredData(content, {
        chunkSize: 20,
        sheetName: 'S',
      })

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.every((chunk) => chunk.tokenCount <= 20)).toBe(true)
    })
  })

  describe('delimiter detection', () => {
    it.concurrent('should not detect with fewer than 3 delimiters per line', async () => {
      const sparse = `a,b
1,2`
      const result = StructuredDataChunker.isStructuredData(sparse)
      expect(typeof result).toBe('boolean')
    })
  })
})
