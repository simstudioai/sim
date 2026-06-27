/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '@/lib/table/rows/cursor'

describe('cursor codec', () => {
  it('encodes a keyset cursor for the default order and round-trips it', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: 'a0' },
      nextOffset: 100,
    })
    expect(typeof token).toBe('string')
    expect(decodeCursor(token)).toEqual({ after: { orderKey: 'a0', id: 'row-9' } })
  })

  it('falls back to an offset cursor when a custom sort is active', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: 'a0' },
      sort: { wins: 'desc' },
      nextOffset: 100,
    })
    expect(decodeCursor(token)).toEqual({ offset: 100 })
  })

  it('falls back to an offset cursor when the row has no order key (legacy)', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: undefined },
      nextOffset: 50,
    })
    expect(decodeCursor(token)).toEqual({ offset: 50 })
  })

  it('produces opaque base64url with no raw orderKey/offset leaking', () => {
    const token = encodeCursor({ lastRow: { id: 'r', orderKey: 'zz' }, nextOffset: 0 })
    expect(token).not.toContain('orderKey')
    expect(token).not.toContain('{')
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('throws on a malformed cursor', () => {
    expect(() => decodeCursor('not-base64-$$$')).toThrow('Invalid cursor')
    // Valid base64url but wrong shape.
    expect(() => decodeCursor(Buffer.from('{"x":1}').toString('base64url'))).toThrow(
      'Invalid cursor'
    )
  })
})
