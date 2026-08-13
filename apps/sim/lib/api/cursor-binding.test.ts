/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  cursorFilterScope,
  cursorSortKey,
  decodeOffsetCursor,
  decodeSortedCursor,
  encodeOffsetCursor,
  encodeScopedCursor,
  encodeSortedCursor,
  readScopedCursor,
  readSortedCursor,
} from '@/app/api/v2/lib/response'

/**
 * A v2 cursor names a position in one exact sequence, and every v2 list decides
 * that sequence from its sort AND its filters. Replay a cursor against a
 * re-filtered read and the two schemes fail differently but both fail: an
 * offset names an unrelated ordinal, and a keyset silently drops every match
 * that sorts before its position. Neither is distinguishable from a correct
 * page by a caller holding an opaque token, so both are refused.
 *
 * These assertions hold all three shared codecs — the offset used by
 * `GET /skills` and `GET /knowledge/{id}/documents`, the keyset used by the nine
 * SQL-ordered lists, and the wrapper that binds the domain-minted tokens on
 * `GET /logs`, `GET /audit-logs`, and `GET /billing/logs` — to that one rule.
 */
describe('v2 cursor binding', () => {
  const sort = cursorSortKey('name', 'asc')
  const filters = { workspaceId: 'ws-1', search: undefined as string | undefined }
  const scope = cursorFilterScope(filters)

  describe('offset cursor', () => {
    it('resumes a cursor replayed under the same query state', () => {
      expect(decodeOffsetCursor(encodeOffsetCursor(sort, scope, 40), sort, scope)).toBe(40)
    })

    it('rejects a cursor replayed under a different sort', () => {
      const cursor = encodeOffsetCursor(sort, scope, 40)

      expect(() => decodeOffsetCursor(cursor, cursorSortKey('createdAt', 'asc'), scope)).toThrow(
        /sortBy\/sortOrder/
      )
      expect(() => decodeOffsetCursor(cursor, cursorSortKey('name', 'desc'), scope)).toThrow(
        /sortBy\/sortOrder/
      )
    })

    it('rejects a cursor replayed under a different filter', () => {
      const cursor = encodeOffsetCursor(sort, scope, 40)

      expect(() =>
        decodeOffsetCursor(cursor, sort, cursorFilterScope({ ...filters, search: 'deploy' }))
      ).toThrow(/requested filters/)
      expect(() =>
        decodeOffsetCursor(cursor, sort, cursorFilterScope({ ...filters, workspaceId: 'ws-2' }))
      ).toThrow(/requested filters/)
    })

    it('treats an absent cursor as page one', () => {
      expect(decodeOffsetCursor(undefined, sort, scope)).toBe(0)
    })

    it('rejects a cursor that is not valid base64-JSON', () => {
      expect(() => decodeOffsetCursor('not-a-cursor', sort, scope)).toThrow()
    })

    it('rejects an offset that is not a non-negative integer', () => {
      expect(() => decodeOffsetCursor(encodeOffsetCursor(sort, scope, -1), sort, scope)).toThrow(
        'Invalid cursor'
      )
      expect(() => decodeOffsetCursor(encodeOffsetCursor(sort, scope, 1.5), sort, scope)).toThrow(
        'Invalid cursor'
      )
    })
  })

  describe('keyset cursor', () => {
    const keys = ['notes.md', 'file-1']

    it('resumes a cursor replayed under the same query state', () => {
      expect(readSortedCursor(encodeSortedCursor(sort, keys, scope), 'name', 'asc', scope)).toEqual(
        keys
      )
    })

    /**
     * A keyset position stays coherent under a changed filter — that is exactly
     * why it is dangerous. The page it returns is duplicate-free and correctly
     * ordered, and silently missing every match that sorts before the cursor.
     */
    it('rejects a cursor replayed under a different filter', () => {
      const cursor = encodeSortedCursor(sort, keys, scope)
      const narrowed = cursorFilterScope({ ...filters, search: 'deploy' })

      expect(decodeSortedCursor(cursor, sort, narrowed)).toEqual({ status: 'refiltered' })
      expect(() => readSortedCursor(cursor, 'name', 'asc', narrowed)).toThrow(/requested filters/)
    })

    /**
     * The two stamps are checked separately so the 400 names the half that
     * actually changed, rather than telling a caller who narrowed a search term
     * to go re-read the sort documentation.
     */
    it('names the sort when the sort is what changed', () => {
      expect(() =>
        readSortedCursor(encodeSortedCursor(sort, keys, scope), 'createdAt', 'asc', scope)
      ).toThrow(/sortBy\/sortOrder/)
    })

    it('refuses an unfiltered cursor replayed under a filter, and the reverse', () => {
      const unfiltered = encodeSortedCursor(sort, keys, undefined)

      expect(() => readSortedCursor(unfiltered, 'name', 'asc', scope)).toThrow(/requested filters/)
      expect(() =>
        readSortedCursor(encodeSortedCursor(sort, keys, scope), 'name', 'asc', undefined)
      ).toThrow(/requested filters/)
    })

    it('treats an absent cursor as page one', () => {
      expect(readSortedCursor(undefined, 'name', 'asc', scope)).toBeUndefined()
    })
  })

  describe('scoped wrapper for domain-minted cursors', () => {
    it('round-trips the domain token untouched', () => {
      expect(readScopedCursor(encodeScopedCursor(scope, 'domain-token'), scope)).toBe(
        'domain-token'
      )
    })

    it('rejects a token replayed under different filters', () => {
      const cursor = encodeScopedCursor(scope, 'domain-token')

      expect(() =>
        readScopedCursor(cursor, cursorFilterScope({ ...filters, search: 'deploy' }))
      ).toThrow(/requested filters/)
    })

    it('treats an absent cursor as page one', () => {
      expect(readScopedCursor(undefined, scope)).toBeUndefined()
    })

    it('rejects a token that is not valid base64-JSON', () => {
      expect(() => readScopedCursor('not-a-cursor', scope)).toThrow()
    })
  })

  describe('scope fingerprint', () => {
    /**
     * `limit` selects how much of the sequence to return, not what the sequence
     * is, so it is never a scope part and paging with a different page size must
     * keep working.
     */
    it('is unaffected by the page size', () => {
      expect(decodeOffsetCursor(encodeOffsetCursor(sort, scope, 40), sort, scope)).toBe(40)
    })

    it('does not depend on the order the parts are written', () => {
      expect(cursorScopeKey({ b: '2', a: '1' })).toBe(cursorScopeKey({ a: '1', b: '2' }))
    })

    it('treats an omitted part and an undefined part as the same scope', () => {
      expect(cursorScopeKey({ a: '1', b: undefined })).toBe(cursorScopeKey({ a: '1' }))
    })

    it('has no fingerprint at all when nothing is filtered', () => {
      expect(cursorScopeKey({ a: undefined })).toBeUndefined()
    })

    /**
     * Distinct queries must not collide across part boundaries: `{a:'1',b:'2'}`
     * and `{a:'1|2'}` are different reads and must fingerprint differently.
     */
    it('separates parts rather than concatenating their values', () => {
      expect(cursorScopeKey({ a: '1', b: '2' })).not.toBe(cursorScopeKey({ a: '1|2' }))
      expect(cursorScopeKey({ a: '1' })).not.toBe(cursorScopeKey({ b: '1' }))
    })

    it('stays short enough to sit inside an opaque token', () => {
      expect(cursorScopeKey({ search: 'x'.repeat(200) })).toHaveLength(22)
    })
  })
})
