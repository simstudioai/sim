import { describe, expect, it } from 'vitest'
import {
  addOverlap,
  iterateLosslessWordBoundaryChunkSpans,
  resolveChunkerOptions,
  splitAtWordBoundaries,
} from './utils'

describe('addOverlap', () => {
  it('snaps overlap to word boundary', () => {
    const chunks = ['hello beautiful world', 'next chunk']
    const result = addOverlap(chunks, 15)
    expect(result[1]).toBe('beautiful world next chunk')
  })
})

describe('splitAtWordBoundaries', () => {
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-positive, fractional, or non-finite chunk size: %s',
    (chunkSize) => {
      expect(() => splitAtWordBoundaries('bounded text', chunkSize)).toThrow(
        'Word-boundary chunk size must be a positive safe integer'
      )
    }
  )

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
})

describe('iterateLosslessWordBoundaryChunkSpans', () => {
  it('preserves every source character while preferring word boundaries', () => {
    const text = '  alpha   beta gamma  '
    const spans = Array.from(iterateLosslessWordBoundaryChunkSpans(text, 8))

    expect(spans.map((span) => span.text).join('')).toBe(text)
    expect(spans.every((span) => span.text.length <= 8)).toBe(true)
    for (const span of spans) {
      expect(text.slice(span.startIndex, span.endIndex)).toBe(span.text)
    }
  })

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid chunk size: %s',
    (chunkSize) => {
      expect(() =>
        Array.from(iterateLosslessWordBoundaryChunkSpans('bounded text', chunkSize))
      ).toThrow('Lossless word-boundary chunk size must be a positive safe integer')
    }
  )
})

describe('resolveChunkerOptions', () => {
  it('clamps overlap to max 50% of chunkSize', () => {
    const result = resolveChunkerOptions({ chunkSize: 100, chunkOverlap: 80 })
    expect(result.chunkOverlap).toBe(50)
  })

  it('normalizes a fractional legacy token size before deriving character windows', () => {
    expect(resolveChunkerOptions({ chunkSize: 100.5 }).chunkSize).toBe(100)
  })

  it('rejects a token size whose character window would exceed safe integer bounds', () => {
    expect(() => resolveChunkerOptions({ chunkSize: Number.MAX_SAFE_INTEGER })).toThrow(
      'Chunk size must be a finite number between 1'
    )
  })
})
