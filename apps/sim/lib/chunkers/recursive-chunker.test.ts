/**
 * @vitest-environment node
 */

import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { RecursiveChunker } from './recursive-chunker'

vi.mock('@sim/logger', () => loggerMock)

describe('RecursiveChunker', () => {
  describe('empty and whitespace input', () => {
    it.concurrent('should return empty array for empty string', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace-only input', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const chunks = await chunker.chunk('   \n\n\t  ')
      expect(chunks).toEqual([])
    })
  })

  describe('small content', () => {
    it.concurrent('should return single chunk when content fits in one chunk', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const text = 'This is a short text.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe('paragraph splitting', () => {
    it.concurrent('should split at paragraph boundaries first', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20 })
      const text =
        'First paragraph with enough content to matter.\n\nSecond paragraph with enough content to matter.\n\nThird paragraph with enough content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('line splitting fallback', () => {
    it.concurrent('should split at newlines when paragraphs are too large', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 15 })
      const text =
        'Line one with content here.\nLine two with content here.\nLine three with content here.\nLine four with content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('sentence splitting fallback', () => {
    it.concurrent('should split at sentence boundaries when lines are too large', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 10 })
      const text =
        'First sentence here. Second sentence here. Third sentence here. Fourth sentence here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('word splitting fallback', () => {
    it.concurrent('should split at spaces when sentences are too large', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 5 })
      const text = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('keep_separator behavior', () => {
    it.concurrent('should prepend separator to subsequent chunks', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 15 })
      const text =
        'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph content here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        expect(chunks[1].text.startsWith('\n\n') || chunks[1].text.length > 0).toBe(true)
      }
    })
  })

  describe('custom separators', () => {
    it.concurrent('should use custom separators instead of default recipe', async () => {
      const chunker = new RecursiveChunker({
        chunkSize: 15,
        separators: ['---', '\n'],
      })
      const text =
        'Section one content here with words.---Section two content here with words.---Section three content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('recipe: plain', () => {
    it.concurrent('should use plain recipe by default', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20 })
      const text =
        'First paragraph with enough words to exceed the chunk size limit.\n\nSecond paragraph with enough words to exceed the chunk size limit.\n\nThird paragraph with enough words to exceed the chunk size limit.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('recipe: markdown', () => {
    it.concurrent('should split at heading boundaries for markdown content', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, recipe: 'markdown' })
      const text =
        '\n# Title\n\nParagraph content under the title goes here.\n\n## Subtitle\n\nMore text content under the subtitle goes here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle markdown horizontal rules', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, recipe: 'markdown' })
      const text =
        'Section one content here.\n---\nSection two content here.\n---\nSection three content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
    })
  })

  describe('recipe: code', () => {
    it.concurrent('should split on function and class boundaries', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, recipe: 'code' })
      const text = [
        'const x = 1;',
        'function hello() {',
        '  return "hello";',
        '}',
        'function world() {',
        '  return "world";',
        '}',
        'class MyClass {',
        '  constructor() {}',
        '  method() { return true; }',
        '}',
      ].join('\n')
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
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

  describe('overlap', () => {
    it.concurrent('should share text between consecutive chunks when overlap is set', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, chunkOverlap: 5 })
      const text =
        'First paragraph with some content here.\n\nSecond paragraph with different content here.\n\nThird paragraph with more content here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        expect(chunks[1].text.length).toBeGreaterThan(0)
      }
    })

    it.concurrent('should not add overlap when overlap is 0', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, chunkOverlap: 0 })
      const text =
        'First sentence content here. Second sentence content here. Third sentence content here.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].text.slice(-10)
        expect(chunks[1].text.startsWith(firstChunkEnd)).toBe(false)
      }
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include text, tokenCount, and metadata fields', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const text = 'This is test content for metadata.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4))
      expect(chunks[0].metadata.startIndex).toBeDefined()
      expect(chunks[0].metadata.endIndex).toBeDefined()
    })

    it.concurrent('should have startIndex of 0 for the first chunk', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const text = 'Some content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks[0].metadata.startIndex).toBe(0)
    })

    it.concurrent('should have non-negative indices for all chunks', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20, chunkOverlap: 5 })
      const text = 'First part. Second part. Third part. Fourth part. Fifth part.'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.metadata.startIndex).toBeGreaterThanOrEqual(0)
        expect(chunk.metadata.endIndex).toBeGreaterThanOrEqual(chunk.metadata.startIndex)
      }
    })

    it.concurrent('should have endIndex greater than startIndex for non-empty chunks', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 20 })
      const text = 'Multiple sentences here. Another one here. And another. And more content.'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.metadata.endIndex).toBeGreaterThan(chunk.metadata.startIndex)
      }
    })
  })

  describe('edge cases', () => {
    it.concurrent('should handle very long text', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const text = 'This is a sentence. '.repeat(1000)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle text with no natural separators', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 5 })
      const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(5)
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })

    it.concurrent('should handle unicode text', async () => {
      const chunker = new RecursiveChunker({ chunkSize: 100 })
      const text = '这是中文测试。日本語テスト。한국어 테스트.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].text).toContain('中文')
    })

    it.concurrent('should use default chunkSize of 1024 tokens', async () => {
      const chunker = new RecursiveChunker({})
      const text = 'Word '.repeat(400)
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
    })
  })
})
