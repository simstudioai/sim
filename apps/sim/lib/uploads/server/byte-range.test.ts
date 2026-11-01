import { describe, expect, it } from 'vitest'
import { resolveByteRange } from '@/lib/uploads/server/byte-range'

const SIZE = 1000
const ETAG = '"abc"'

function resolve(range: string | null, options?: { ifRange?: string | null; etag?: string }) {
  return resolveByteRange({
    range,
    ifRange: options?.ifRange ?? null,
    etag: options && 'etag' in options ? options.etag : ETAG,
    size: SIZE,
  })
}

describe('resolveByteRange', () => {
  it('serves the full representation when no range is asked for', () => {
    expect(resolve(null)).toEqual({ kind: 'full' })
    expect(resolve('')).toEqual({ kind: 'full' })
  })

  it('reads a closed range as inclusive offsets', () => {
    expect(resolve('bytes=0-499')).toEqual({ kind: 'partial', range: { start: 0, end: 499 } })
    expect(resolve('bytes=10-10')).toEqual({ kind: 'partial', range: { start: 10, end: 10 } })
  })

  it('runs an open-ended range to the last byte', () => {
    expect(resolve('bytes=900-')).toEqual({ kind: 'partial', range: { start: 900, end: 999 } })
  })

  it('reads a suffix range as the final N bytes', () => {
    expect(resolve('bytes=-100')).toEqual({ kind: 'partial', range: { start: 900, end: 999 } })
  })

  it('clamps an end past the representation to its last byte', () => {
    expect(resolve('bytes=500-5000')).toEqual({ kind: 'partial', range: { start: 500, end: 999 } })
  })

  it('serves every byte for a suffix longer than the representation', () => {
    expect(resolve('bytes=-5000')).toEqual({ kind: 'partial', range: { start: 0, end: 999 } })
  })

  it('treats the range unit case-insensitively and tolerates surrounding whitespace', () => {
    expect(resolve('Bytes= 0-1 ')).toEqual({ kind: 'partial', range: { start: 0, end: 1 } })
  })

  it('refuses a range that starts at or past the end', () => {
    expect(resolve('bytes=1000-')).toEqual({ kind: 'unsatisfiable' })
    expect(resolve('bytes=1000-1200')).toEqual({ kind: 'unsatisfiable' })
  })

  it('refuses an empty suffix', () => {
    expect(resolve('bytes=-0')).toEqual({ kind: 'unsatisfiable' })
  })

  it.each([
    'items=0-1',
    'bytes',
    'bytes=',
    'bytes=-',
    'bytes=abc',
    'bytes=5-2',
    'bytes=1-2-3',
    'bytes=-1-2',
    'bytes=+1-2',
    'bytes=0x10-20',
    'bytes=1.5-2',
    'bytes=99999999999999999999-',
  ])('ignores the malformed header %j and serves everything', (header) => {
    expect(resolve(header)).toEqual({ kind: 'full' })
  })

  it('ignores a multi-range request rather than assembling a multipart body', () => {
    expect(resolve('bytes=0-1,5-6')).toEqual({ kind: 'full' })
  })

  it('serves an empty representation whole, since no range of it exists', () => {
    expect(resolveByteRange({ range: 'bytes=0-', ifRange: null, etag: ETAG, size: 0 })).toEqual({
      kind: 'full',
    })
  })

  describe('If-Range', () => {
    it('honors the range while the client still holds the current bytes', () => {
      expect(resolve('bytes=0-9', { ifRange: ETAG })).toEqual({
        kind: 'partial',
        range: { start: 0, end: 9 },
      })
    })

    it('sends everything once the bytes have changed, so stale parts are never spliced', () => {
      expect(resolve('bytes=0-9', { ifRange: '"other"' })).toEqual({ kind: 'full' })
    })

    it('never matches a weak validator, which cannot vouch for byte-identical parts', () => {
      expect(resolve('bytes=0-9', { ifRange: `W/${ETAG}` })).toEqual({ kind: 'full' })
    })

    it('sends everything for the date form, since no Last-Modified is ever issued', () => {
      expect(resolve('bytes=0-9', { ifRange: 'Wed, 21 Oct 2015 07:28:00 GMT' })).toEqual({
        kind: 'full',
      })
    })

    it('sends everything when the representation has no validator to compare against', () => {
      expect(resolve('bytes=0-9', { ifRange: ETAG, etag: undefined })).toEqual({ kind: 'full' })
    })

    it('does not turn an unsatisfiable range into a 416 once the bytes have changed', () => {
      expect(resolve('bytes=5000-', { ifRange: '"other"' })).toEqual({ kind: 'full' })
    })
  })
})
