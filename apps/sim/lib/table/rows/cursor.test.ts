/**
 * @vitest-environment node
 *
 * Opaque cursor encode/decode and the cursor↔query binding. A cursor encodes a
 * position in one specific ordering of one specific row set; replaying it under
 * any other ordering or filter silently pages the wrong sequence, so binding
 * violations must throw rather than return wrong rows.
 */
import { describe, expect, it } from 'vitest'
import { TableQueryValidationError } from '@/lib/table/errors'
import {
  assertCursorQueryBinding,
  canonicalFilterKey,
  canonicalSortKey,
  decodeCursor,
  encodeCursor,
} from '@/lib/table/rows/cursor'
import type { TablePredicate } from '@/lib/table/types'

const ROW = { id: 'row_1', orderKey: 'a1' }
const ACTIVE: TablePredicate = { all: [{ field: 'status', op: 'eq', value: 'active' }] }
const ARCHIVED: TablePredicate = { all: [{ field: 'status', op: 'eq', value: 'archived' }] }

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
    expect(() => assertCursorQueryBinding(decoded, { sort: { col_a: 'desc' } })).not.toThrow()
  })

  it('rejects replay under a DIFFERENT sort', () => {
    const decoded = { offset: 100, sortKey: canonicalSortKey({ col_a: 'desc' }) }
    for (const sort of [{ col_a: 'asc' as const }, { col_b: 'desc' as const }, undefined]) {
      expect(() => assertCursorQueryBinding(decoded, { sort })).toThrow(TableQueryValidationError)
      try {
        assertCursorQueryBinding(decoded, { sort })
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
    expect(() => assertCursorQueryBinding(decoded, { sort: { col_a: 'asc' } })).toThrow(
      /different sort|sorted query/
    )
    expect(() => assertCursorQueryBinding(decoded, {})).not.toThrow()
  })

  it('keyset cursors stay default-order only and never carry a sort stamp', () => {
    const token = encodeCursor({ lastRow: ROW, keysetValid: true, nextOffset: 10 })
    const decoded = decodeCursor(token)
    expect(decoded.after).toEqual({ orderKey: 'a1', id: 'row_1' })
    expect(decoded.sortKey).toBeUndefined()
    expect(() => assertCursorQueryBinding(decoded, { sort: { col_a: 'asc' } })).toThrow(
      /sorted query/
    )
    expect(() => assertCursorQueryBinding(decoded, {})).not.toThrow()
  })

  it('sort key order is significant (priority is part of the identity)', () => {
    expect(canonicalSortKey({ a: 'asc', b: 'desc' })).not.toBe(
      canonicalSortKey({ b: 'desc', a: 'asc' })
    )
  })
})

describe('cursor↔filter binding', () => {
  it('stamps a sorted page with the predicate it was minted under', () => {
    const decoded = decodeCursor(
      encodeCursor({
        lastRow: { id: 'row_1', orderKey: null },
        keysetValid: false,
        nextOffset: 100,
        sort: { col_a: 'desc' },
        predicate: ACTIVE,
      })
    )
    expect(decoded.offset).toBe(100)
    expect(decoded.filterKey).toBe(canonicalFilterKey({ predicate: ACTIVE }))
  })

  it('rejects replaying a page-2 offset against a DIFFERENT predicate', () => {
    const decoded = decodeCursor(
      encodeCursor({
        lastRow: { id: 'row_1', orderKey: null },
        keysetValid: false,
        nextOffset: 100,
        sort: { name: 'asc' },
        predicate: ACTIVE,
      })
    )

    expect(() =>
      assertCursorQueryBinding(decoded, { sort: { name: 'asc' }, predicate: ARCHIVED })
    ).toThrow(TableQueryValidationError)
    try {
      assertCursorQueryBinding(decoded, { sort: { name: 'asc' }, predicate: ARCHIVED })
    } catch (e) {
      expect((e as TableQueryValidationError).code).toBe('CURSOR_FILTER_CONFLICT')
    }
    expect(() =>
      assertCursorQueryBinding(decoded, { sort: { name: 'asc' }, predicate: ACTIVE })
    ).not.toThrow()
  })

  it('rejects dropping the predicate from a filtered offset cursor', () => {
    const decoded = decodeCursor(
      encodeCursor({
        lastRow: { id: 'row_1', orderKey: null },
        keysetValid: false,
        nextOffset: 100,
        predicate: ACTIVE,
      })
    )
    expect(() => assertCursorQueryBinding(decoded, {})).toThrow(/different filter/)
  })

  it('rejects adding a predicate to an unfiltered offset cursor', () => {
    const decoded = decodeCursor(
      encodeCursor({
        lastRow: { id: 'row_1', orderKey: null },
        keysetValid: false,
        nextOffset: 100,
      })
    )
    expect(decoded.filterKey).toBeUndefined()
    expect(() => assertCursorQueryBinding(decoded, { predicate: ACTIVE })).toThrow(
      /different filter/
    )
  })

  it('binds the compound cursor, whose offset also counts filtered rows', () => {
    const decoded = decodeCursor(
      encodeCursor({
        lastRow: { id: 'row_9', orderKey: null },
        keysetValid: true,
        nextOffset: 40,
        seekBase: { anchor: { orderKey: 'a1', id: 'row_1' }, offsetFromAnchor: 12 },
        predicate: ACTIVE,
      })
    )
    expect(decoded.after).toEqual({ orderKey: 'a1', id: 'row_1' })
    expect(decoded.offset).toBe(12)
    expect(() => assertCursorQueryBinding(decoded, { predicate: ARCHIVED })).toThrow(
      /different filter/
    )
    expect(() => assertCursorQueryBinding(decoded, { predicate: ACTIVE })).not.toThrow()
  })

  it('binds a pure keyset cursor to its filter too', () => {
    /**
     * A keyset position is absolute in `(order_key, id)`, which is why this was
     * once left unbound. Absolute ordering is not the same as completeness:
     * replaying the cursor under a wider filter silently omits every match that
     * sorts before it, and the caller reads the short page as the end of the
     * sequence rather than as an error.
     */
    const decoded = decodeCursor(
      encodeCursor({ lastRow: ROW, keysetValid: true, nextOffset: 10, predicate: ACTIVE })
    )
    expect(decoded.filterKey).toBe(canonicalFilterKey({ predicate: ACTIVE }))
    expect(() => assertCursorQueryBinding(decoded, { predicate: ACTIVE })).not.toThrow()
    expect(() => assertCursorQueryBinding(decoded, {})).toThrow(/different filter/i)
  })

  it('fingerprints structurally equal predicates identically, key order aside', () => {
    expect(
      canonicalFilterKey({
        predicate: { all: [{ op: 'eq', field: 'status', value: 'active' }] } as TablePredicate,
      })
    ).toBe(canonicalFilterKey({ predicate: ACTIVE }))
    expect(canonicalFilterKey({})).toBeUndefined()
    expect(canonicalFilterKey({ filter: {} })).toBeUndefined()
  })
})

/**
 * The filter stamp is additive, and the payload version is deliberately not
 * bumped for it (see `CURSOR_VERSION`). These pin what a token minted by the
 * previous deploy does when it is replayed after this one.
 */
describe('tokens minted before the filter stamp', () => {
  function legacyToken(payload: Record<string, unknown>): string {
    return Buffer.from(JSON.stringify({ ...payload, v: 1 })).toString('base64url')
  }

  it('still decodes, and still resumes an unfiltered read', () => {
    const decoded = decodeCursor(legacyToken({ k: 'a1', i: 'row_1' }))
    expect(decoded.after).toEqual({ orderKey: 'a1', id: 'row_1' })
    expect(decoded.filterKey).toBeUndefined()
    expect(() => assertCursorQueryBinding(decoded, {})).not.toThrow()
  })

  it('fails a filtered read with the filter conflict, not an unreadable cursor', () => {
    const decoded = decodeCursor(legacyToken({ o: 100 }))
    expect(() => assertCursorQueryBinding(decoded, { predicate: ACTIVE })).toThrow(
      TableQueryValidationError
    )
    expect(() => assertCursorQueryBinding(decoded, { predicate: ACTIVE })).toThrow(
      /Restart paging without the cursor/
    )
    /**
     * The code, not just the wording, is what a bumped `CURSOR_VERSION` would
     * cost: every in-flight token would fail `INVALID_CURSOR` at decode instead,
     * including the unfiltered ones that resume fine today.
     */
    try {
      assertCursorQueryBinding(decoded, { predicate: ACTIVE })
      expect.unreachable('a re-filtered replay must be refused')
    } catch (e) {
      expect((e as TableQueryValidationError).code).toBe('CURSOR_FILTER_CONFLICT')
    }
  })

  /**
   * The version a token minted today carries. Pinned so a bump is a deliberate
   * edit here rather than a silent one that strands every cursor a running
   * deploy already handed out.
   */
  it('mints tokens at the version the previous deploy could already read', () => {
    const token = encodeCursor({ lastRow: ROW, keysetValid: true, nextOffset: 10 })

    expect(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')).v).toBe(1)
  })
})
