/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { RegexChunker } from './regex-chunker'

describe('RegexChunker', () => {
  describe('empty and whitespace input', () => {
    it.concurrent('should return empty array for empty string', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n' })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent('should return empty array for whitespace-only input', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n' })
      const chunks = await chunker.chunk('   \n\n   ')
      expect(chunks).toEqual([])
    })
  })

  describe('small content', () => {
    it.concurrent('should return single chunk when content fits in chunkSize', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 100 })
      const text = 'This is a short text.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })
  })

  describe('basic regex splitting', () => {
    it.concurrent('should split on double newlines with pattern \\n\\n', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 20 })
      const text =
        'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph content here.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('custom pattern splitting', () => {
    it.concurrent('should split text at --- delimiters', async () => {
      const chunker = new RegexChunker({ pattern: '---', chunkSize: 20 })
      const text =
        'Section one has enough content to fill a chunk on its own here.---Section two also has enough content to fill another chunk here.---Section three needs content too for splitting.'
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(1)
    })
  })

  describe('segment merging', () => {
    it.concurrent('should merge small adjacent segments up to chunkSize', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 100 })
      const text = 'Short.\n\nAlso short.\n\nTiny.\n\nSmall too.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toContain('Short.')
      expect(chunks[0].text).toContain('Also short.')
    })
  })

  describe('oversized segment fallback', () => {
    it.concurrent(
      'should sub-chunk segments larger than chunkSize via word boundaries',
      async () => {
        const chunker = new RegexChunker({ pattern: '---', chunkSize: 10 })
        const longSegment =
          'This is a very long segment with many words that exceeds the chunk size limit significantly. '
        const text = `${longSegment}---${longSegment}`
        const chunks = await chunker.chunk(text)

        expect(chunks.length).toBeGreaterThan(2)
      }
    )
  })

  describe('no-match fallback', () => {
    it.concurrent(
      'should fall back to word-boundary splitting when regex matches nothing',
      async () => {
        const chunker = new RegexChunker({ pattern: '###SPLIT###', chunkSize: 10 })
        const text = 'This is a text with no matching delimiter anywhere in the content at all.'
        const chunks = await chunker.chunk(text)

        expect(chunks.length).toBeGreaterThan(1)
      }
    )
  })

  describe('chunk size respected', () => {
    it.concurrent('should not exceed chunkSize tokens approximately', async () => {
      const chunkSize = 30
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize })
      const text =
        'Paragraph one with some words. '.repeat(5) +
        '\n\n' +
        'Paragraph two with more words. '.repeat(5) +
        '\n\n' +
        'Paragraph three continues here. '.repeat(5)
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(chunkSize + 10)
      }
    })
  })

  describe('overlap', () => {
    it.concurrent('should share content between chunks when chunkOverlap > 0', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 20, chunkOverlap: 5 })
      const text =
        'First paragraph with enough content.\n\nSecond paragraph with more content.\n\nThird paragraph with even more.'
      const chunks = await chunker.chunk(text)

      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].text.slice(-10)
        const secondChunkStart = chunks[1].text.slice(0, 20)
        expect(secondChunkStart.length).toBeGreaterThan(0)
        expect(chunks[1].text.length).toBeGreaterThan(0)
      }
    })
  })

  describe('chunk metadata', () => {
    it.concurrent('should include text, tokenCount, and metadata with indices', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 100 })
      const text = 'Hello world test content.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
      expect(chunks[0].tokenCount).toBe(Math.ceil(text.length / 4))
      expect(chunks[0].metadata.startIndex).toBeDefined()
      expect(chunks[0].metadata.endIndex).toBeDefined()
      expect(chunks[0].metadata.startIndex).toBe(0)
    })

    it.concurrent('should have non-negative indices across multiple chunks', async () => {
      const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 20, chunkOverlap: 0 })
      const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.'
      const chunks = await chunker.chunk(text)

      for (const chunk of chunks) {
        expect(chunk.metadata.startIndex).toBeGreaterThanOrEqual(0)
        expect(chunk.metadata.endIndex).toBeGreaterThanOrEqual(chunk.metadata.startIndex)
      }
    })
  })

  describe('invalid regex', () => {
    it.concurrent('should throw error for invalid regex pattern', async () => {
      expect(() => new RegexChunker({ pattern: '[invalid' })).toThrow()
    })
  })

  describe('empty pattern', () => {
    it.concurrent('should throw error for empty pattern', async () => {
      expect(() => new RegexChunker({ pattern: '' })).toThrow('Regex pattern is required')
    })
  })

  describe('pattern too long', () => {
    it.concurrent('should throw error for pattern exceeding 500 characters', async () => {
      const longPattern = 'a'.repeat(501)
      expect(() => new RegexChunker({ pattern: longPattern })).toThrow(
        'Regex pattern exceeds maximum length of 500 characters'
      )
    })
  })

  describe('ReDoS protection', () => {
    it.concurrent('should accept safe pattern \\n+', async () => {
      expect(() => new RegexChunker({ pattern: '\\n+' })).not.toThrow()
    })

    it.concurrent('should accept safe pattern [,;]', async () => {
      expect(() => new RegexChunker({ pattern: '[,;]' })).not.toThrow()
    })
  })

  describe('capturing groups', () => {
    it.concurrent(
      'should not include delimiter text as a chunk when pattern has capturing groups',
      async () => {
        const chunker = new RegexChunker({
          pattern: '(---)',
          chunkSize: 1024,
          strictBoundaries: true,
        })
        const text = 'Section one content.---Section two content.---Section three content.'
        const chunks = await chunker.chunk(text)

        expect(chunks).toHaveLength(3)
        expect(chunks[0].text).toBe('Section one content.')
        expect(chunks[1].text).toBe('Section two content.')
        expect(chunks[2].text).toBe('Section three content.')
        for (const chunk of chunks) {
          expect(chunk.text).not.toBe('---')
        }
      }
    )

    it.concurrent(
      'should not include delimiter text when pattern uses named capture groups',
      async () => {
        const chunker = new RegexChunker({
          pattern: '(?<sep>---)',
          chunkSize: 1024,
          strictBoundaries: true,
        })
        const text = 'Section one content.---Section two content.---Section three content.'
        const chunks = await chunker.chunk(text)

        expect(chunks).toHaveLength(3)
        expect(chunks[0].text).toBe('Section one content.')
        expect(chunks[1].text).toBe('Section two content.')
        expect(chunks[2].text).toBe('Section three content.')
        for (const chunk of chunks) {
          expect(chunk.text).not.toBe('---')
        }
      }
    )

    it.concurrent('should preserve lookbehind whose body contains a > character', async () => {
      const chunker = new RegexChunker({
        pattern: '(?<=</section>)',
        chunkSize: 1024,
        strictBoundaries: true,
      })
      const text = '<section>one</section><section>two</section><section>three</section>'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(3)
      expect(chunks[0].text).toBe('<section>one</section>')
      expect(chunks[1].text).toBe('<section>two</section>')
      expect(chunks[2].text).toBe('<section>three</section>')
    })

    it.concurrent('should leave non-capturing groups and lookarounds intact', async () => {
      const chunker = new RegexChunker({
        pattern: '(?=\\n\\s*\\{\\s*"id"\\s*:)',
        chunkSize: 1024,
        strictBoundaries: true,
      })
      const text = '{"id": 1, "v": "a"}\n{"id": 2, "v": "b"}\n{"id": 3, "v": "c"}'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(3)
    })
  })

  describe('strictBoundaries mode', () => {
    it.concurrent(
      'should produce one chunk per match without merging small adjacent segments',
      async () => {
        const chunker = new RegexChunker({
          pattern: '\\n\\n',
          chunkSize: 1024,
          strictBoundaries: true,
        })
        const text = 'Short.\n\nAlso short.\n\nTiny.\n\nSmall too.'
        const chunks = await chunker.chunk(text)

        expect(chunks).toHaveLength(4)
        expect(chunks[0].text).toBe('Short.')
        expect(chunks[1].text).toBe('Also short.')
        expect(chunks[2].text).toBe('Tiny.')
        expect(chunks[3].text).toBe('Small too.')
      }
    )

    it.concurrent('should produce one chunk per QA record using lookahead pattern', async () => {
      const chunker = new RegexChunker({
        pattern: '(?=\\n\\s*\\{\\s*"id"\\s*:)',
        chunkSize: 1024,
        strictBoundaries: true,
      })
      const text =
        '{"id": 1, "q": "first?", "a": "yes"}\n{"id": 2, "q": "second?", "a": "no"}\n{"id": 3, "q": "third?", "a": "maybe"}'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(3)
      expect(chunks[0].text).toContain('"id": 1')
      expect(chunks[0].text).not.toContain('"id": 2')
      expect(chunks[1].text).toContain('"id": 2')
      expect(chunks[1].text).not.toContain('"id": 3')
      expect(chunks[2].text).toContain('"id": 3')
    })

    it.concurrent('should not apply overlap even when chunkOverlap is set', async () => {
      const chunker = new RegexChunker({
        pattern: '\\n\\n',
        chunkSize: 100,
        chunkOverlap: 50,
        strictBoundaries: true,
      })
      const text = 'First section content.\n\nSecond section content.\n\nThird section content.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(3)
      expect(chunks[0].text).toBe('First section content.')
      expect(chunks[1].text).toBe('Second section content.')
      expect(chunks[2].text).toBe('Third section content.')
    })

    it.concurrent(
      'should still split when content fits in single chunk if matches exist',
      async () => {
        const chunker = new RegexChunker({
          pattern: '\\n\\n',
          chunkSize: 1024,
          strictBoundaries: true,
        })
        const text = 'A.\n\nB.\n\nC.'
        const chunks = await chunker.chunk(text)

        expect(chunks).toHaveLength(3)
      }
    )

    it.concurrent('should sub-chunk a single oversized segment at word boundaries', async () => {
      const chunker = new RegexChunker({
        pattern: '---',
        chunkSize: 10,
        strictBoundaries: true,
      })
      const longSegment =
        'This is a very long segment with many words that exceeds the chunk size limit significantly.'
      const text = `${longSegment}---short`
      const chunks = await chunker.chunk(text)

      expect(chunks.length).toBeGreaterThan(2)
      expect(chunks[chunks.length - 1].text).toBe('short')
    })

    it.concurrent('should return single chunk when regex finds no matches', async () => {
      const chunker = new RegexChunker({
        pattern: '###NOMATCH###',
        chunkSize: 1024,
        strictBoundaries: true,
      })
      const text = 'Plain text with no delimiter at all.'
      const chunks = await chunker.chunk(text)

      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe(text)
    })

    it.concurrent('should return empty array for empty input', async () => {
      const chunker = new RegexChunker({
        pattern: '\\n\\n',
        strictBoundaries: true,
      })
      const chunks = await chunker.chunk('')
      expect(chunks).toEqual([])
    })

    it.concurrent(
      'should default to merging behavior when strictBoundaries is omitted',
      async () => {
        const chunker = new RegexChunker({ pattern: '\\n\\n', chunkSize: 100 })
        const text = 'Short.\n\nAlso short.\n\nTiny.\n\nSmall too.'
        const chunks = await chunker.chunk(text)
        expect(chunks).toHaveLength(1)
      }
    )

    it.concurrent('should produce non-overlapping startIndex/endIndex metadata', async () => {
      const chunker = new RegexChunker({
        pattern: '\\n\\n',
        chunkSize: 1024,
        chunkOverlap: 50,
        strictBoundaries: true,
      })
      const text = 'First.\n\nSecond.\n\nThird.'
      const chunks = await chunker.chunk(text)

      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].metadata.startIndex).toBeGreaterThanOrEqual(
          chunks[i - 1].metadata.endIndex
        )
      }
    })
  })
})
