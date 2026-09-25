import { describe, expect, it } from 'vitest'
import { MAX_CHUNKING_SEPARATOR_LENGTH, MAX_CHUNKING_SEPARATORS } from '@/lib/chunkers/constants'
import { RecursiveChunker } from '@/lib/chunkers/recursive-chunker'

describe('RecursiveChunker', () => {
  describe('separator bounds', () => {
    it.concurrent('ignores separators past the list bound', async () => {
      const separators = [
        ...Array.from({ length: MAX_CHUNKING_SEPARATORS }, (_, i) => `@@nomatch${i}@@`),
        '---',
      ]
      const chunker = new RecursiveChunker({ chunkSize: 15, separators })
      const text =
        'Section one content here with words.---Section two content here with words.---Section three content here.'

      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks.some((chunk) => chunk.text.includes('---'))).toBe(true)
    })

    it.concurrent('drops a separator longer than the per-item bound', async () => {
      const oversized = '|'.repeat(MAX_CHUNKING_SEPARATOR_LENGTH + 1)
      const chunker = new RecursiveChunker({ chunkSize: 15, separators: [oversized, '---'] })
      const text = `Section one content here.${oversized}Section two content.---Section three content.`

      const chunks = await chunker.chunk(text)

      expect(chunks.some((chunk) => chunk.text.includes('|'))).toBe(true)
      expect(chunks.every((chunk) => !chunk.text.includes('---'))).toBe(true)
    })

    it.concurrent('falls back to the recipe when every separator is over the bound', async () => {
      const oversized = '|'.repeat(MAX_CHUNKING_SEPARATOR_LENGTH + 1)
      const text =
        'Section one content here with words.\n\nSection two content here with words.\n\nSection three content.'

      const chunks = await new RecursiveChunker({ chunkSize: 15, separators: [oversized] }).chunk(
        text
      )
      const defaultChunks = await new RecursiveChunker({ chunkSize: 15 }).chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks).toEqual(defaultChunks)
    })
  })

  describe('chunk size respected', () => {
    it.concurrent('should not exceed chunk size in tokens', async () => {
      const chunkSize = 30
      const chunker = new RecursiveChunker({ chunkSize })
      const text = 'This is a test sentence with content. '.repeat(30)
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize + 5)
      }
    })
  })
})
