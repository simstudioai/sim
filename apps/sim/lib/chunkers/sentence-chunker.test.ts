import { describe, expect, it } from 'vitest'
import { SentenceChunker } from './sentence-chunker'

describe('SentenceChunker', () => {
  describe('abbreviation handling', () => {
    it.concurrent('should not split at common abbreviations', async () => {
      const chunker = new SentenceChunker({ chunkSize: 200 })
      const text = 'Mr. Smith went to Washington. He arrived on Jan. 5th.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('Mr. Smith')
      expect(chunks[0].text).toContain('Jan. 5th')
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

  describe('minSentencesPerChunk', () => {
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
  })
})
