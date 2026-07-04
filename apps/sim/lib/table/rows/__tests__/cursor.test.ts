/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '@/lib/table/rows/cursor'

describe('cursor codec', () => {
  it('encodes a keyset cursor when keyset is valid and round-trips it', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: 'a0' },
      keysetValid: true,
      nextOffset: 100,
    })
    expect(typeof token).toBe('string')
    expect(decodeCursor(token)).toEqual({ after: { orderKey: 'a0', id: 'row-9' } })
  })

  it('falls back to an offset cursor when keyset is not valid (custom sort / flag off)', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: 'a0' },
      keysetValid: false,
      nextOffset: 100,
    })
    expect(decodeCursor(token)).toEqual({ offset: 100 })
  })

  it('emits a compound cursor when the last row is unkeyed but an anchor is known', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: undefined },
      keysetValid: true,
      nextOffset: 50,
      seekBase: { anchor: { orderKey: 'a5', id: 'row-5' }, offsetFromAnchor: 4 },
    })
    expect(decodeCursor(token)).toEqual({ after: { orderKey: 'a5', id: 'row-5' }, offset: 4 })
  })

  it('falls back to a whole-view offset when the row has no order key and no anchor', () => {
    const token = encodeCursor({
      lastRow: { id: 'row-9', orderKey: undefined },
      keysetValid: true,
      nextOffset: 50,
    })
    expect(decodeCursor(token)).toEqual({ offset: 50 })
  })

  it('produces opaque base64url with no raw orderKey/offset leaking', () => {
    const token = encodeCursor({
      lastRow: { id: 'r', orderKey: 'zz' },
      keysetValid: true,
      nextOffset: 0,
    })
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

  it('throws on valid JSON that is not an object (no raw TypeError leak)', () => {
    for (const body of ['42', 'null', '"hi"', 'true', '[1,2]']) {
      expect(() => decodeCursor(Buffer.from(body).toString('base64url'))).toThrow('Invalid cursor')
    }
  })

  it('rejects negative and non-integer offsets', () => {
    expect(() => decodeCursor(Buffer.from('{"o":-1}').toString('base64url'))).toThrow(
      'Invalid cursor'
    )
    expect(() => decodeCursor(Buffer.from('{"o":1.5}').toString('base64url'))).toThrow(
      'Invalid cursor'
    )
  })
})
