import { describe, expect, it } from 'vitest'
import { TokenChunker } from './token-chunker'

describe('TokenChunker', () => {
  describe('respects chunk size', () => {
    it.concurrent('should not produce chunks exceeding chunkSize tokens', async () => {
      const chunkSize = 50
      const chunker = new TokenChunker({ chunkSize })
      const text = 'This is a test sentence with several words. '.repeat(30)
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize)
      }
    })
  })

  describe('overlap clamped to 50%', () => {
    it.concurrent('should clamp overlap to 50% of chunkSize', async () => {
      const chunkerClamped = new TokenChunker({ chunkSize: 20, chunkOverlap: 100 })
      const chunkerHalf = new TokenChunker({ chunkSize: 20, chunkOverlap: 10 })
      const text =
        'Word one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty. '.repeat(
          5
        )

      const clampedChunks = await chunkerClamped.chunk(text)
      const halfChunks = await chunkerHalf.chunk(text)

      expect(clampedChunks.length).toBe(halfChunks.length)
    })
  })

  describe('consistent coverage', () => {
    it.concurrent('should preserve all words across chunks for longer text', async () => {
      const chunker = new TokenChunker({ chunkSize: 20, chunkOverlap: 0 })
      const words = [
        'alpha',
        'bravo',
        'charlie',
        'delta',
        'echo',
        'foxtrot',
        'golf',
        'hotel',
        'india',
        'juliet',
      ]
      const originalText = `${words.join(' is a word and ')} is also a word.`
      const chunks = await chunker.chunk(originalText)

      const combined = chunks.map((c) => c.text).join(' ')
      for (const word of words) {
        expect(combined).toContain(word)
      }
    })
  })
})
