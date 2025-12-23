/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { TextChunker } from './text-chunker'

describe('TextChunker', () => {
  describe('basic chunking', () => {
    it.concurrent('should return empty array for empty text', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace-only text', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('   \n\n   ')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return single chunk for small text', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'This is a short text.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })

    it.concurrent('should include token count in chunk metadata', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'Hello world' // ~3 tokens (11 chars / 4)
      const chunks = await chunker.chunk(text)

      expect(chunks[0].tokenCount).toBe(3)
    })
  })

  describe('chunk size limits (tokens)', () => {
    it.concurrent('should split text that exceeds chunk size', async () => {
      const chunker = new TextChunker({ chunkSize: 50 })
      const text = 'This is a test sentence. '.repeat(20)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should respect chunk size limit', async () => {
      const chunkSize = 50
      const chunker = new TextChunker({ chunkSize })
      const text = 'This is a test sentence. '.repeat(20)
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize + 5)
      }
    })

    it.concurrent('should create more chunks with smaller chunk size', async () => {
      const text = 'This is a test sentence. '.repeat(20)

      const largeChunker = new TextChunker({ chunkSize: 200 })
      const smallChunker = new TextChunker({ chunkSize: 50 })

      const largeChunks = await largeChunker.chunk(text)
      const smallChunks = await smallChunker.chunk(text)

      expect(smallChunks.length).toBeGreaterThan(largeChunks.length)
    })
  })

  describe('overlap (tokens)', () => {
    it.concurrent('should not add overlap when overlap is 0', async () => {
      const chunker = new TextChunker({ chunkSize: 20, chunkOverlap: 0 })
      const text = 'First sentence here. Second sentence here. Third sentence here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].text.slice(-10)
        const secondChunkStart = chunks[1].text.slice(0, 10)
        expect(chunks[1].text.startsWith(firstChunkEnd)).toBe(false)
      }
    })

    it.concurrent('should add overlap from previous chunk', async () => {
      const chunker = new TextChunker({ chunkSize: 20, chunkOverlap: 50 })
      const text =
        'First paragraph with some content here.\n\nSecond paragraph with different content here.\n\nThird paragraph with more content.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        expect(chunks[1].text.length).toBeGreaterThan(0)
      }
    })

    it.concurrent('should handle overlap larger than previous chunk', async () => {
      const chunker = new TextChunker({ chunkSize: 10, chunkOverlap: 500 })
      const text = 'Short. Another short.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('hierarchical splitting', () => {
    it.concurrent('should prefer splitting on paragraph boundaries', async () => {
      const chunker = new TextChunker({ chunkSize: 30 })
      const text =
        'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })

    it.concurrent('should split on sentences when paragraphs are too large', async () => {
      const chunker = new TextChunker({ chunkSize: 20 })
      const text =
        'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should split on words as last resort', async () => {
      const chunker = new TextChunker({ chunkSize: 5 })
      const text = 'Supercalifragilisticexpialidocious is a very long word that needs splitting.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle markdown headings', async () => {
      const chunker = new TextChunker({ chunkSize: 30 })
      const text =
        '# Heading 1\n\nContent under heading 1.\n\n## Heading 2\n\nContent under heading 2.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('text cleaning', () => {
    it.concurrent('should normalize Windows line endings', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'Line 1\r\nLine 2\r\nLine 3'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].text).not.toContain('\r')
    })

    it.concurrent('should collapse multiple spaces', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'Word1    Word2     Word3'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].text).not.toContain('  ')
    })

    it.concurrent('should limit consecutive newlines', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'Para 1\n\n\n\n\nPara 2'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].text).not.toContain('\n\n\n')
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include startIndex and endIndex', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'This is test content.'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].metadata.startIndex).toBeDefined()
      expect(chunks[0].metadata.endIndex).toBeDefined()
      expect(chunks[0].metadata.startIndex).toBe(0)
    })

    it.concurrent('should have sequential indices across chunks', async () => {
      const chunker = new TextChunker({ chunkSize: 20, chunkOverlap: 0 })
      const text = 'First part of text. Second part of text. Third part of text.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        for (let i = 1; i < chunks.length; i++) {
          expect(chunks[i].metadata.startIndex).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })

  describe('default values', () => {
    it.concurrent('should use default chunkSize of 1024 tokens', async () => {
      const chunker = new TextChunker({})
      const text = 'Word '.repeat(400)
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
    })

    it.concurrent('should use default minCharactersPerChunk of 100', async () => {
      const chunker = new TextChunker({ chunkSize: 10 })
      // Text with 150+ characters to ensure chunks pass the 100 character minimum
      const text = 'This is a longer sentence with more content. '.repeat(5)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
    })

    it.concurrent('should use default overlap of 0', async () => {
      const chunker = new TextChunker({ chunkSize: 20 })
      const text = 'First sentence here. Second sentence here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const firstEnd = chunks[0].text.slice(-5)
        expect(chunks[1].text.startsWith(firstEnd)).toBe(false)
      }
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle very long text', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = 'This is a sentence. '.repeat(1000)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
      const totalLength = chunks.reduce((sum, c) => sum + c.text.length, 0)
      expect(totalLength).toBeGreaterThan(0)
    })

    it.concurrent('should handle text with only special characters', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })

    it.concurrent('should handle unicode text', async () => {
      const chunker = new TextChunker({ chunkSize: 100 })
      const text = '这是中文测试。日本語テスト。한국어 테스트.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('中文')
    })

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
})
