/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { TokenChunker } from './token-chunker'

describe('TokenChunker', () => {
  describe('empty and whitespace input', () => {
    it.concurrent('should return empty array for empty string', async () => {
      const chunker = new TokenChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace-only input', async () => {
      const chunker = new TokenChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('   \n\n\t  ')
      expect(chunks).toEqual([])
    })
  })

  describe('small content', () => {
    it.concurrent('should return single chunk when content fits within chunkSize', async () => {
      const chunker = new TokenChunker({ chunkSize: 100 })
      const text = 'This is a short text.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe('token count accuracy', () => {
    it.concurrent('should compute tokenCount as Math.ceil(text.length / 4)', async () => {
      const chunker = new TokenChunker({ chunkSize: 100 })
      const text = 'Hello world'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4))
    })

    it.concurrent('should compute tokenCount correctly for longer text', async () => {
      const chunker = new TokenChunker({ chunkSize: 100 })
      const text = 'The quick brown fox jumps over the lazy dog.'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].tokenCount).toBe(11)
    })
  })

  describe('chunk metadata', () => {
    it.concurrent(
      'should include text, tokenCount, and metadata with startIndex and endIndex',
      async () => {
        const chunker = new TokenChunker({ chunkSize: 100 })
        const text = 'Some test content here.'
        const chunks = await chunker.chunk(text)

        expect(chunks[0]).toHaveProperty('text')
        expect(chunks[0]).toHaveProperty('tokenCount')
        expect(chunks[0].metadata).toHaveProperty('startIndex')
        expect(chunks[0].metadata).toHaveProperty('endIndex')
        expect(chunks[0].metadata.startIndex).toBe(0)
        expect(chunks[0].metadata.endIndex).toBeGreaterThan(0)
      }
    )

    it.concurrent('should have non-negative indices across all chunks', async () => {
      const chunker = new TokenChunker({ chunkSize: 20, chunkOverlap: 0 })
      const text = 'First part of the text. Second part of the text. Third part of the text.'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.metadata.startIndex).toBeGreaterThanOrEqual(0)
        expect(chunk.metadata.endIndex).toBeGreaterThanOrEqual(chunk.metadata.startIndex)
      }
    })
  })

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

  describe('splitting behavior', () => {
    it.concurrent('should produce multiple chunks for long text', async () => {
      const chunker = new TokenChunker({ chunkSize: 50 })
      const text = 'This is a test sentence. '.repeat(30)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should create more chunks with smaller chunkSize', async () => {
      const text = 'This is a test sentence with content. '.repeat(20)

      const largeChunker = new TokenChunker({ chunkSize: 200 })
      const smallChunker = new TokenChunker({ chunkSize: 50 })

      const largeChunks = await largeChunker.chunk(text)
      const smallChunks = await smallChunker.chunk(text)

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length)
    })
  })

  describe('sliding window overlap', () => {
    it.concurrent('should produce more chunks with overlap than without', async () => {
      const text =
        'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu. '.repeat(
          5
        )
      const withOverlap = new TokenChunker({ chunkSize: 30, chunkOverlap: 10 })
      const withoutOverlap = new TokenChunker({ chunkSize: 30, chunkOverlap: 0 })

      const overlapChunks = await withOverlap.chunk(text)
      const noOverlapChunks = await withoutOverlap.chunk(text)

      expect(overlapChunks.length).toBeGreaterThan(noOverlapChunks.length)
    })

    it.concurrent('should not share text between chunks when chunkOverlap is 0', async () => {
      const chunker = new TokenChunker({ chunkSize: 20, chunkOverlap: 0 })
      const text =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].text.slice(-10)
        expect(chunks[1].text.startsWith(firstChunkEnd)).toBe(false)
      }
    })
  })

  describe('overlap clamped to 50%', () => {
    it.concurrent('should still work when overlap is set >= chunkSize', async () => {
      const chunker = new TokenChunker({ chunkSize: 20, chunkOverlap: 100 })
      const text =
        'First paragraph content here. Second paragraph content here. Third paragraph here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
    })

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

  describe('word boundary snapping', () => {
    it.concurrent('should produce trimmed chunks without leading or trailing spaces', async () => {
      const chunker = new TokenChunker({ chunkSize: 20 })
      const text =
        'the cat sat on the mat and the dog ran fast over the big red fox and then the bird flew high up in the clear blue sky above the green hill'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        const trimmed = chunk.text.trim()
        expect(trimmed).toBe(chunk.text)
        expect(trimmed.length).toBeGreaterThan(0)
      }
    })

    it.concurrent('should produce chunks that start and end on word boundaries', async () => {
      const chunker = new TokenChunker({ chunkSize: 15 })
      const text =
        'The quick brown fox jumps over the lazy dog and then runs away quickly into the forest'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        const trimmed = chunk.text.trim()
        expect(trimmed).toBe(chunk.text)
      }
    })
  })

  describe('consistent coverage', () => {
    it.concurrent('should represent all content from original text across chunks', async () => {
      const chunker = new TokenChunker({ chunkSize: 30, chunkOverlap: 0 })
      const originalText =
        'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.'
      const chunks = await chunker.chunk(originalText)

      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('quick')
      expect(allText).toContain('fox')
      expect(allText).toContain('lazy')
      expect(allText).toContain('dog')
      expect(allText).toContain('liquor')
      expect(allText).toContain('jugs')
    })

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
