/**
 * @vitest-environment node
 *
 * Opaque cursor encode/decode and the cursor↔sort binding. A cursor encodes a
 * position in one specific ordering; replaying it under any other ordering
 * silently pages the wrong sequence, so binding violations must throw
 * CURSOR_SORT_CONFLICT rather than return wrong rows.
 */
import { describe, expect, it } from 'vitest'
import { TableQueryValidationError } from '@/lib/table/errors'
import {
  assertCursorSortBinding,
  canonicalSortKey,
  decodeCursor,
  encodeCursor,
} from '@/lib/table/rows/cursor'

const ROW = { id: 'row_1', orderKey: 'a1' }

describe('cursor↔sort binding (bugbot round 2)', () => {
  it('stamps an offset cursor with the sort it was minted under', () => {
    const token = encodeCursor({
      lastRow: { id: 'row_1', orderKey: null },
      keysetValid: false,
      nextOffset: 100,
      sort: { col_a: 'desc' },
    })
    const decoded = decodeCursor(token)
    expect(decoded.offset).toBe(100)
    expect(decoded.sortKey).toBe(canonicalSortKey({ col_a: 'desc' }))
  })

  it('accepts replay under the identical sort', () => {
    const decoded = { offset: 100, sortKey: canonicalSortKey({ col_a: 'desc' }) }
    expect(() => assertCursorSortBinding(decoded, { col_a: 'desc' })).not.toThrow()
  })

  it('rejects replay under a DIFFERENT sort', () => {
    const decoded = { offset: 100, sortKey: canonicalSortKey({ col_a: 'desc' }) }
    for (const sort of [{ col_a: 'asc' as const }, { col_b: 'desc' as const }, undefined]) {
      expect(() => assertCursorSortBinding(decoded, sort)).toThrow(TableQueryValidationError)
      try {
        assertCursorSortBinding(decoded, sort)
      } catch (e) {
        expect((e as TableQueryValidationError).code).toBe('CURSOR_SORT_CONFLICT')
      }
    }
  })

  it('rejects adding a sort to an unsorted offset cursor', () => {
    const token = encodeCursor({
      lastRow: { id: 'row_1', orderKey: null },
      keysetValid: false,
      nextOffset: 50,
    })
    const decoded = decodeCursor(token)
    expect(decoded.sortKey).toBeUndefined()
    expect(() => assertCursorSortBinding(decoded, { col_a: 'asc' })).toThrow(
      /different sort|sorted query/
    )
    expect(() => assertCursorSortBinding(decoded, undefined)).not.toThrow()
  })

  it('keyset cursors stay default-order only and never carry a sort stamp', () => {
    const token = encodeCursor({ lastRow: ROW, keysetValid: true, nextOffset: 10 })
    const decoded = decodeCursor(token)
    expect(decoded.after).toEqual({ orderKey: 'a1', id: 'row_1' })
    expect(decoded.sortKey).toBeUndefined()
    expect(() => assertCursorSortBinding(decoded, { col_a: 'asc' })).toThrow(/sorted query/)
    expect(() => assertCursorSortBinding(decoded, undefined)).not.toThrow()
  })

  it('sort key order is significant (priority is part of the identity)', () => {
    expect(canonicalSortKey({ a: 'asc', b: 'desc' })).not.toBe(
      canonicalSortKey({ b: 'desc', a: 'asc' })
    )
  })
})
