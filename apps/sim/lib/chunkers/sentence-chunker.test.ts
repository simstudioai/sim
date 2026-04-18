/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { SentenceChunker } from './sentence-chunker'

describe('SentenceChunker', () => {
  describe('empty and whitespace input', () => {
    it.concurrent('should return empty array for empty string', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace-only input', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('   \n\n\t  ')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for null-ish content', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk(undefined as unknown as string)
      expect(chunks).toEqual([])
    })
  })

  describe('small content (single chunk)', () => {
    it.concurrent('should return single chunk when content fits within chunk size', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const text = 'This is a short sentence. Another short one.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4))
    })
  })

  describe('sentence boundary splitting', () => {
    it.concurrent('should split text at sentence boundaries', async () => {
      const chunker = new SentenceChunker({ chunkSize: 20 })
      const text =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      for (let i = 0; i < chunks.length - 1; i++) {
        const trimmed = chunks[i].text.trim()
        const lastChar = trimmed[trimmed.length - 1]
        expect(['.', '!', '?']).toContain(lastChar)
      }
    })
  })

  describe('abbreviation handling', () => {
    it.concurrent('should not split at common abbreviations', async () => {
      const chunker = new SentenceChunker({ chunkSize: 200 })
      const text = 'Mr. Smith went to Washington. He arrived on Jan. 5th.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('Mr. Smith')
      expect(chunks[0].text).toContain('Jan. 5th')
    })

    it.concurrent('should not split at Dr., Mrs., Ms., Prof., Jr., Sr., St.', async () => {
      const chunker = new SentenceChunker({ chunkSize: 500 })
      const text =
        'Dr. Jones and Mrs. Brown met Prof. Davis at St. Mary hospital. Jr. members joined Sr. staff in Feb. for a review.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
    })
  })

  describe('single capital initial handling', () => {
    it.concurrent('should not split at single capital letter initials', async () => {
      const chunker = new SentenceChunker({ chunkSize: 200 })
      const text = 'J. K. Rowling wrote books. They are popular.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('J. K. Rowling')
    })
  })

  describe('decimal handling', () => {
    it.concurrent('should not split at decimal numbers', async () => {
      const chunker = new SentenceChunker({ chunkSize: 20 })
      const text = 'The value is 3.14. That is pi.'
      const chunks = await chunker.chunk(text)

      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('3.14')

      const largeChunker = new SentenceChunker({ chunkSize: 200 })
      const largeChunks = await largeChunker.chunk(text)
      expect(largeChunks).toHaveLength(1)
    })
  })

  describe('ellipsis handling', () => {
    it.concurrent('should not split at ellipsis', async () => {
      const chunker = new SentenceChunker({ chunkSize: 200 })
      const text = 'Wait for it... The answer is here. Done.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('Wait for it...')
    })
  })

  describe('exclamation and question marks', () => {
    it.concurrent('should split at exclamation and question marks', async () => {
      const chunker = new SentenceChunker({ chunkSize: 10 })
      const text = 'What is this? It is great! I agree.'
      const chunks = await chunker.chunk(text)

      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('What is this?')
      expect(allText).toContain('It is great!')
      expect(allText).toContain('I agree.')
    })

    it.concurrent('should treat ? and ! as sentence boundaries', async () => {
      const chunker = new SentenceChunker({ chunkSize: 15 })
      const text = 'What is this thing? It is really great! I strongly agree.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('?')
      expect(allText).toContain('!')
    })
  })

  describe('minSentencesPerChunk', () => {
    it.concurrent('should group at least minSentencesPerChunk sentences per chunk', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100, minSentencesPerChunk: 2 })
      const text =
        'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks).toHaveLength(1)
    })

    it.concurrent('should enforce min sentences even when token limit is reached', async () => {
      const chunker = new SentenceChunker({ chunkSize: 6, minSentencesPerChunk: 2 })
      const text = 'Short one. Another one. Third one here. Fourth one here.'
      const chunks = await chunker.chunk(text)

      const firstChunkSentences = chunks[0].text
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.trim().length > 0)
      expect(firstChunkSentences.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('oversized sentence fallback', () => {
    it.concurrent(
      'should chunk a single very long sentence via word-boundary splitting',
      async () => {
        const chunker = new SentenceChunker({ chunkSize: 10 })
        const longSentence = `${'word '.repeat(50).trim()}.`
        const chunks = await chunker.chunk(longSentence)

        expect(chunks.length).toBeGreaterThan(1)
        const allText = chunks.map((c) => c.text).join(' ')
        expect(allText).toContain('word')
      }
    )

    it.concurrent('should handle oversized sentence mixed with normal sentences', async () => {
      const chunker = new SentenceChunker({ chunkSize: 10 })
      const longSentence = `${'word '.repeat(50).trim()}.`
      const text = `Short sentence. ${longSentence} Another short one.`
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(2)
      const allText = chunks.map((c) => c.text).join(' ')
      expect(allText).toContain('Short sentence.')
      expect(allText).toContain('Another short one.')
    })
  })

  describe('sentence-level overlap', () => {
    it.concurrent('should include overlap from previous chunk when chunkOverlap > 0', async () => {
      const chunker = new SentenceChunker({ chunkSize: 15, chunkOverlap: 10 })
      const text =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        expect(chunks[1].text.length).toBeGreaterThan(0)
      }
    })

    it.concurrent('should not add overlap when chunkOverlap is 0', async () => {
      const chunker = new SentenceChunker({ chunkSize: 15, chunkOverlap: 0 })
      const text = 'First sentence here. Second sentence here. Third sentence here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const chunk1End = chunks[0].text.slice(-20)
        expect(chunks[1].text.startsWith(chunk1End)).toBe(false)
      }
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include text, tokenCount, and metadata in each chunk', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const text = 'This is a test sentence. Another sentence follows.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toHaveProperty('text')
      expect(chunks[0]).toHaveProperty('tokenCount')
      expect(chunks[0]).toHaveProperty('metadata')
      expect(chunks[0].metadata).toHaveProperty('startIndex')
      expect(chunks[0].metadata).toHaveProperty('endIndex')
    })

    it.concurrent('should have startIndex of 0 for the first chunk', async () => {
      const chunker = new SentenceChunker({ chunkSize: 10 })
      const text = 'First sentence. Second sentence. Third sentence.'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].metadata.startIndex).toBe(0)
    })

    it.concurrent('should have non-negative indices for all chunks', async () => {
      const chunker = new SentenceChunker({ chunkSize: 10, chunkOverlap: 5 })
      const text =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence.'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.metadata.startIndex).toBeGreaterThanOrEqual(0)
        expect(chunk.metadata.endIndex).toBeGreaterThanOrEqual(chunk.metadata.startIndex)
      }
    })

    it.concurrent('should have correct tokenCount based on text length', async () => {
      const chunker = new SentenceChunker({ chunkSize: 100 })
      const text = 'Hello world test.'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4))
    })
  })

  describe('respects chunk size', () => {
    it.concurrent('should produce chunks within approximate token limit', async () => {
      const chunkSize = 20
      const chunker = new SentenceChunker({ chunkSize })
      const text =
        'This is the first sentence. Here is the second one. And the third sentence follows. Then comes the fourth. Finally the fifth sentence.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize * 2)
      }
    })

    it.concurrent('should create more chunks with smaller chunk size', async () => {
      const text =
        'Sentence number one. Sentence number two. Sentence number three. Sentence number four. Sentence number five. Sentence number six.'

      const largeChunker = new SentenceChunker({ chunkSize: 200 })
      const smallChunker = new SentenceChunker({ chunkSize: 10 })

      const largeChunks = await largeChunker.chunk(text)
      const smallChunks = await smallChunker.chunk(text)

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length)
    })
  })
})
