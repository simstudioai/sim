/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  addOverlap,
  buildChunks,
  cleanText,
  estimateTokens,
  resolveChunkerOptions,
  splitAtWordBoundaries,
  tokensToChars,
} from './utils'

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns 0 for whitespace-only string', () => {
    expect(estimateTokens('   ')).toBe(0)
  })

  it('returns 0 for null or undefined via optional chaining', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0)
    expect(estimateTokens(undefined as unknown as string)).toBe(0)
  })

  it('returns Math.ceil(text.length / 4) for normal text', () => {
    const text = 'Hello world'
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4))
  })

  it('estimates "Hello world" (11 chars) as 3 tokens', () => {
    expect(estimateTokens('Hello world')).toBe(3)
  })
})

describe('tokensToChars', () => {
  it('returns tokens * 4', () => {
    expect(tokensToChars(1)).toBe(4)
    expect(tokensToChars(5)).toBe(20)
  })

  it('converts 10 tokens to 40 chars', () => {
    expect(tokensToChars(10)).toBe(40)
  })
})

describe('cleanText', () => {
  it('normalizes \\r\\n to \\n', () => {
    expect(cleanText('hello\r\nworld')).toBe('hello\nworld')
  })

  it('normalizes \\r to \\n', () => {
    expect(cleanText('hello\rworld')).toBe('hello\nworld')
  })

  it('collapses 3+ newlines to \\n\\n', () => {
    expect(cleanText('hello\n\n\n\nworld')).toBe('hello\n\nworld')
  })

  it('replaces tabs with spaces', () => {
    expect(cleanText('hello\tworld')).toBe('hello world')
  })

  it('collapses multiple spaces to single space', () => {
    expect(cleanText('hello    world')).toBe('hello world')
  })

  it('trims leading and trailing whitespace', () => {
    expect(cleanText('  hello world  ')).toBe('hello world')
  })
})

describe('addOverlap', () => {
  it('returns unchanged chunks when overlapChars <= 0', () => {
    const chunks = ['chunk one', 'chunk two']
    expect(addOverlap(chunks, 0)).toEqual(chunks)
    expect(addOverlap(chunks, -5)).toEqual(chunks)
  })

  it('returns unchanged chunks when only 1 chunk', () => {
    const chunks = ['only chunk']
    expect(addOverlap(chunks, 10)).toEqual(chunks)
  })

  it('prepends tail of previous chunk to next chunk with overlap > 0', () => {
    const chunks = ['first chunk here', 'second chunk here']
    const result = addOverlap(chunks, 10)
    expect(result[0]).toBe('first chunk here')
    expect(result[1]).toContain('second chunk here')
    expect(result[1].length).toBeGreaterThan('second chunk here'.length)
  })

  it('joins overlap text with space', () => {
    const chunks = ['first chunk here', 'second chunk here']
    const result = addOverlap(chunks, 10)
    expect(result[1]).toContain('here second')
  })

  it('snaps overlap to word boundary', () => {
    const chunks = ['hello beautiful world', 'next chunk']
    const result = addOverlap(chunks, 15)
    expect(result[1]).toBe('beautiful world next chunk')
  })
})

describe('splitAtWordBoundaries', () => {
  it('returns single element for short text', () => {
    const result = splitAtWordBoundaries('short text', 100)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('short text')
  })

  it('produces multiple chunks for long text', () => {
    const text = 'word '.repeat(100).trim()
    const result = splitAtWordBoundaries(text, 20)
    expect(result.length).toBeGreaterThan(1)
  })

  it('respects chunk size limit', () => {
    const text = 'word '.repeat(100).trim()
    const chunkSize = 25
    const result = splitAtWordBoundaries(text, chunkSize)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(chunkSize)
    }
  })

  it('does not break mid-word', () => {
    const text = 'internationalization globalization modernization'
    const result = splitAtWordBoundaries(text, 25)
    for (const chunk of result) {
      expect(chunk).not.toMatch(/^\S+\s\S+$.*\S$/)
      const words = chunk.split(' ')
      for (const word of words) {
        expect(text).toContain(word)
      }
    }
  })

  it('produces overlapping chunks with stepChars < chunkSizeChars', () => {
    const text = 'one two three four five six seven eight nine ten'
    const result = splitAtWordBoundaries(text, 20, 10)
    expect(result.length).toBeGreaterThan(1)
    const combined = result.join(' ')
    for (const word of text.split(' ')) {
      expect(combined).toContain(word)
    }
  })

  it('ensures step is at least 1 to prevent infinite loops', () => {
    const text = 'hello world test'
    const result = splitAtWordBoundaries(text, 10, 0)
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('buildChunks', () => {
  it('creates Chunk objects with text, tokenCount, and metadata', () => {
    const texts = ['hello world', 'foo bar']
    const chunks = buildChunks(texts, 0)
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('text')
      expect(chunk).toHaveProperty('tokenCount')
      expect(chunk).toHaveProperty('metadata')
      expect(chunk.metadata).toHaveProperty('startIndex')
      expect(chunk.metadata).toHaveProperty('endIndex')
    }
  })

  it('sets metadata with startIndex and endIndex', () => {
    const texts = ['chunk one', 'chunk two']
    const chunks = buildChunks(texts, 0)
    expect(typeof chunks[0].metadata.startIndex).toBe('number')
    expect(typeof chunks[0].metadata.endIndex).toBe('number')
  })

  it('sets startIndex of first chunk to 0', () => {
    const texts = ['first chunk', 'second chunk']
    const chunks = buildChunks(texts, 0)
    expect(chunks[0].metadata.startIndex).toBe(0)
  })

  it('produces contiguous chunks with overlapTokens=0', () => {
    const texts = ['hello world', 'foo bar baz']
    const chunks = buildChunks(texts, 0)
    expect(chunks[0].metadata.endIndex).toBe(chunks[1].metadata.startIndex)
  })
})

describe('resolveChunkerOptions', () => {
  it('applies defaults: chunkSize=1024, chunkOverlap=0, minCharactersPerChunk=100', () => {
    const result = resolveChunkerOptions({})
    expect(result.chunkSize).toBe(1024)
    expect(result.chunkOverlap).toBe(0)
    expect(result.minCharactersPerChunk).toBe(100)
  })

  it('clamps overlap to max 50% of chunkSize', () => {
    const result = resolveChunkerOptions({ chunkSize: 100, chunkOverlap: 80 })
    expect(result.chunkOverlap).toBe(50)
  })

  it('respects provided values when within limits', () => {
    const result = resolveChunkerOptions({
      chunkSize: 500,
      chunkOverlap: 100,
      minCharactersPerChunk: 50,
    })
    expect(result.chunkSize).toBe(500)
    expect(result.chunkOverlap).toBe(100)
    expect(result.minCharactersPerChunk).toBe(50)
  })
})
