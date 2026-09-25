import { describe, expect, it } from 'vitest'
import { TextChunker } from './text-chunker'

describe('TextChunker', () => {
  describe('chunk size limits (tokens)', () => {
    it.concurrent('should respect chunk size limit', async () => {
      const chunkSize = 50
      const chunker = new TextChunker({ chunkSize })
      const text = 'This is a test sentence. '.repeat(20)
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize + 5)
      }
    })
  })

  describe('edge cases', () => {
    it.concurrent('should not lose any content during chunking', async () => {
      const chunker = new TextChunker({ chunkSize: 30, chunkOverlap: 0 })
      const originalText =
        'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.'
      const chunks = await chunker.chunk(originalText)

      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('quick')
      expect(allText).toContain('fox')
      expect(allText).toContain('lazy')
      expect(allText).toContain('dog')
    })
  })

  describe('boundary conditions', () => {
    it.concurrent('should handle text exactly at chunk size boundary', async () => {
      const chunker = new TextChunker({ chunkSize: 10 })
      const text = 'A'.repeat(40)
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].tokenCount).toBe(10)
    })
  })
})
