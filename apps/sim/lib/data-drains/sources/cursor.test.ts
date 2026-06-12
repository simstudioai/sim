/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { decodeTimeCursor, encodeTimeCursor } from '@/lib/data-drains/sources/cursor'

describe('time cursor encoding', () => {
  it('round-trips a valid cursor', () => {
    const value = { ts: '2026-01-01T00:00:00.000Z', id: 'row-1' }
    expect(decodeTimeCursor(encodeTimeCursor(value))).toEqual(value)
  })

  it('returns null for null input', () => {
    expect(decodeTimeCursor(null)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(decodeTimeCursor('not-json')).toBeNull()
  })

  it('returns null when shape is wrong', () => {
    expect(decodeTimeCursor(JSON.stringify({ ts: 1, id: 'x' }))).toBeNull()
    expect(decodeTimeCursor(JSON.stringify({ ts: '2026', id: 5 }))).toBeNull()
    expect(decodeTimeCursor(JSON.stringify({}))).toBeNull()
  })
})
