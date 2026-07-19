/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  byteRangeLength,
  contentRangeHeader,
  parseByteRange,
  unsatisfiableContentRangeHeader,
} from '@/lib/uploads/utils/byte-range'

const SIZE = 1000

describe('parseByteRange', () => {
  it('serves the whole object when there is no header', () => {
    expect(parseByteRange(null, SIZE)).toBeNull()
    expect(parseByteRange(undefined, SIZE)).toBeNull()
    expect(parseByteRange('', SIZE)).toBeNull()
  })

  it('parses a closed range', () => {
    expect(parseByteRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 })
    expect(parseByteRange('bytes=500-999', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('parses an open-ended range as running to the last byte', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('parses a suffix range as the final N bytes', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('clamps a suffix longer than the object to the whole object', () => {
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the object to its last byte, never beyond', () => {
    expect(parseByteRange('bytes=0-99999', SIZE)).toEqual({ start: 0, end: 999 })
    expect(parseByteRange('bytes=998-99999', SIZE)).toEqual({ start: 998, end: 999 })
  })

  it('reports a start at or past the object as unsatisfiable', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=5000-6000', SIZE)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable')
  })

  it('ignores a malformed header instead of failing the request', () => {
    for (const header of [
      'bytes=abc-def',
      'bytes=',
      'items=0-10',
      'bytes=0-10, 20-30',
      'bytes=--5',
      'bytes=1.5-2',
      'bytes=-',
    ]) {
      expect(parseByteRange(header, SIZE)).toBeNull()
    }
  })

  it('ignores a reversed range', () => {
    expect(parseByteRange('bytes=500-100', SIZE)).toBeNull()
  })

  it('ignores every header for an empty or unknown-size object', () => {
    expect(parseByteRange('bytes=0-10', 0)).toBeNull()
    expect(parseByteRange('bytes=0-10', Number.NaN)).toBeNull()
  })

  it('never returns an offset outside the object, for any input', () => {
    const headers = [
      'bytes=0-0',
      'bytes=0-999',
      'bytes=999-',
      'bytes=-1',
      'bytes=-999',
      'bytes=-1000',
      'bytes=-1001',
      'bytes=1-99999999',
      `bytes=${Number.MAX_SAFE_INTEGER}-`,
    ]
    for (const header of headers) {
      const parsed = parseByteRange(header, SIZE)
      if (parsed === null || parsed === 'unsatisfiable') continue
      expect(parsed.start).toBeGreaterThanOrEqual(0)
      expect(parsed.end).toBeLessThan(SIZE)
      expect(parsed.start).toBeLessThanOrEqual(parsed.end)
    }
  })
})

describe('header builders', () => {
  it('formats a satisfied range', () => {
    expect(contentRangeHeader({ start: 0, end: 499 }, SIZE)).toBe('bytes 0-499/1000')
  })

  it('formats an unsatisfiable range with the object size', () => {
    expect(unsatisfiableContentRangeHeader(SIZE)).toBe('bytes */1000')
  })

  it('counts an inclusive interval', () => {
    expect(byteRangeLength({ start: 0, end: 0 })).toBe(1)
    expect(byteRangeLength({ start: 0, end: 499 })).toBe(500)
  })
})
