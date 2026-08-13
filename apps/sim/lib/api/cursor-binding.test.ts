/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseV2KnowledgeTagFiltersParam } from '@/lib/api/contracts/v2/knowledge'
import {
  cursorScopeKey,
  instantScopePart,
  parseUnorderedList,
  unorderedScopeOf,
  unorderedScopePart,
} from '@/lib/api/cursor-binding'
import {
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
  const scope = cursorScopeKey(filters)

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
        decodeOffsetCursor(cursor, sort, cursorScopeKey({ ...filters, search: 'deploy' }))
      ).toThrow(/requested filters/)
      expect(() =>
        decodeOffsetCursor(cursor, sort, cursorScopeKey({ ...filters, workspaceId: 'ws-2' }))
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
      const narrowed = cursorScopeKey({ ...filters, search: 'deploy' })

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
        readScopedCursor(cursor, cursorScopeKey({ ...filters, search: 'deploy' }))
      ).toThrow(/requested filters/)
    })

    it('treats an absent cursor as page one', () => {
      expect(readScopedCursor(undefined, scope)).toBeUndefined()
    })

    /**
     * The three lists that mint their own tokens do not share a sort knob —
     * `GET /audit-logs` declares neither `sortBy` nor `sortOrder`, and its query
     * schema is `.strict()` — so an undecodable token must not send the caller
     * to adjust params that would themselves be rejected.
     */
    it('rejects a token that is not valid base64-JSON without naming a sort param', () => {
      expect(() => readScopedCursor('not-a-cursor', scope)).toThrow(/not a valid pagination cursor/)
      expect(() => readScopedCursor('not-a-cursor', scope)).not.toThrow(/sort/i)
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

describe('unordered filter scope parts', () => {
  it('fingerprints a reordered set identically', () => {
    const a = cursorScopeKey({ workflowIds: unorderedScopePart('A,B') })
    const b = cursorScopeKey({ workflowIds: unorderedScopePart('B,A') })
    expect(a).toBe(b)
  })
  it('fingerprints a duplicate-bearing set identically', () => {
    // The filters compile to `inArray`, which is set membership, so A,A,B
    // selects exactly what A,B does and must resume the same page.
    expect(cursorScopeKey({ workflowIds: unorderedScopePart('A,A,B') })).toBe(
      cursorScopeKey({ workflowIds: unorderedScopePart('A,B') })
    )
    expect(unorderedScopePart('B,A,B')).toBe('A,B')
  })

  /**
   * The scope and the query must read one parse. When the scope trimmed members
   * and the route split the raw value itself, `A,B` and `A, B` shared a
   * fingerprint while selecting different rows — a cursor accepted across a
   * change that moved the sequence, which is the failure the binding prevents.
   */
  it('parses the members it fingerprints', () => {
    expect(parseUnorderedList('A, B')).toEqual(['A', 'B'])
    expect(parseUnorderedList('A,B')).toEqual(parseUnorderedList('A, B'))
    expect(unorderedScopePart('A, B')).toBe(parseUnorderedList('A, B')?.join(','))
  })

  /**
   * Tag filters compile to `and(...)`, so reordering the clauses selects the
   * same documents. Binding to the order a caller happened to write them in
   * refused a cursor for a page that was genuinely the next one.
   */
  it('treats an AND-conjoined filter array as a set', () => {
    const ab = [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]
    const ba = [
      { name: 'b', value: '2' },
      { name: 'a', value: '1' },
    ]

    expect(unorderedScopeOf(ab)).toBe(unorderedScopeOf(ba))
    expect(unorderedScopeOf([{ name: 'a' }, { name: 'a' }])).toBe(unorderedScopeOf([{ name: 'a' }]))
    expect(unorderedScopeOf(ab)).not.toBe(unorderedScopeOf([{ name: 'a', value: '1' }]))
  })

  /**
   * The scope binds the parsed filter, so a field the caller omitted and the
   * schema default it parses to are one value by the time they are hashed.
   * Fingerprinting the raw query text instead refused a cursor whenever a
   * caller spelled a default explicitly. Asserted through the contract's own
   * parser, since the defaulting is what makes the two equal.
   */
  it('binds a defaulted field and its omission alike', () => {
    const omitted = parseV2KnowledgeTagFiltersParam('[{"tagName":"a","value":"1"}]')
    const explicit = parseV2KnowledgeTagFiltersParam(
      '[{"tagName":"a","value":"1","operator":"eq"}]'
    )
    const different = parseV2KnowledgeTagFiltersParam(
      '[{"tagName":"a","value":"1","operator":"gt"}]'
    )

    expect(omitted.success && explicit.success && different.success).toBe(true)
    expect(unorderedScopeOf(omitted.success ? omitted.filters : null)).toBe(
      unorderedScopeOf(explicit.success ? explicit.filters : null)
    )
    expect(unorderedScopeOf(omitted.success ? omitted.filters : null)).not.toBe(
      unorderedScopeOf(different.success ? different.filters : null)
    )
  })

  it('has no scope for an absent filter', () => {
    expect(unorderedScopeOf(undefined)).toBeUndefined()
  })

  /**
   * A window bound selects by instant, and `z.string().datetime()` admits every
   * sub-second spelling of one, so binding the text refused a cursor for the
   * same window written a different way.
   */
  it('binds a window bound by its instant, not its spelling', () => {
    expect(instantScopePart('2026-01-01T00:00:00Z')).toBe(
      instantScopePart('2026-01-01T00:00:00.000Z')
    )
    expect(instantScopePart('2026-01-01T00:00:00Z')).not.toBe(
      instantScopePart('2026-01-01T00:00:01Z')
    )
    expect(instantScopePart('not-a-date')).toBe('not-a-date')
    expect(instantScopePart(undefined)).toBeUndefined()
  })

  it('still separates genuinely different sets', () => {
    expect(cursorScopeKey({ workflowIds: unorderedScopePart('A,B') })).not.toBe(
      cursorScopeKey({ workflowIds: unorderedScopePart('A,C') })
    )
  })
  it('treats an all-empty list as absent, matching the parsers', () => {
    expect(unorderedScopePart(',,')).toBeUndefined()
    expect(unorderedScopePart('A,,B')).toBe('A,B')
  })
})
