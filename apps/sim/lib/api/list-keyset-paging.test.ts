/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type CursorKey,
  encodeKeyset,
  type KeysetKey,
  type ListSortOrder,
} from '@/lib/api/list-query'
import { cursorSortKey, decodeSortedCursor, encodeSortedCursor } from '@/app/api/v2/lib/response'

/**
 * Page-boundary correctness for the keyset every v2 cursor list shares.
 *
 * `keysetAfter` renders SQL, so it cannot be evaluated here. What *can* be
 * evaluated — and is the part that actually decides whether a page boundary
 * loses or repeats a row — is the algebra the SQL implements: rows are ordered
 * by the key tuple, a page is the first `limit` of them, and the next page is
 * every row whose tuple is strictly greater than the last emitted row's. This
 * models exactly that, over the same `KeysetKey.encode` functions the real
 * cursors are minted from.
 *
 * The dataset is deliberately degenerate — repeated names and a timestamp
 * shared by four rows — because that is the only place the property can fail. A
 * keyset whose trailing key is not unique cannot separate tied rows, so the
 * "strictly after" step either skips them or serves them twice.
 */

interface Row {
  id: string
  name: string
  createdAt: Date
}

/** A `KeysetKey` reduced to what this simulation needs: how to read its value. */
type EncodeOnly = Pick<KeysetKey<Row>, 'encode'>

const SHARED_INSTANT = new Date('2024-03-01T12:00:00.000Z')

const ROWS: Row[] = [
  { id: 'a', name: 'alpha', createdAt: SHARED_INSTANT },
  { id: 'b', name: 'alpha', createdAt: SHARED_INSTANT },
  { id: 'c', name: 'alpha', createdAt: SHARED_INSTANT },
  { id: 'd', name: 'beta', createdAt: SHARED_INSTANT },
  { id: 'e', name: 'beta', createdAt: new Date('2024-03-02T09:30:00.000Z') },
  { id: 'f', name: 'gamma', createdAt: new Date('2024-03-03T00:00:00.000Z') },
  { id: 'g', name: 'delta', createdAt: new Date('2024-03-04T18:45:00.000Z') },
]

const idKey: EncodeOnly = { encode: (row) => row.id }
const nameKey: EncodeOnly = { encode: (row) => row.name }
const createdAtKey: EncodeOnly = { encode: (row) => row.createdAt.toISOString() }

/** The trailing `id` is what the production sorts add; the third omits it. */
const SORTS = {
  name: [nameKey, idKey],
  createdAt: [createdAtKey, idKey],
  /** Deliberately non-total — used only to prove this test can fail. */
  nameWithoutTiebreaker: [nameKey],
} satisfies Record<string, EncodeOnly[]>

function compareKeys(a: CursorKey[], b: CursorKey[]): number {
  for (const [i, left] of a.entries()) {
    const right = b[i]
    if (left < right) return -1
    if (left > right) return 1
  }
  return 0
}

function ordered(rows: Row[], keys: EncodeOnly[], order: ListSortOrder): Row[] {
  const direction = order === 'asc' ? 1 : -1
  return [...rows].sort(
    (a, b) =>
      direction *
      compareKeys(
        encodeKeyset(keys as KeysetKey<Row>[], a),
        encodeKeyset(keys as KeysetKey<Row>[], b)
      )
  )
}

/** One page: the first `limit` rows strictly after `cursorKeys` in sort order. */
function page(
  keys: EncodeOnly[],
  order: ListSortOrder,
  limit: number,
  cursorKeys?: CursorKey[]
): { data: Row[]; nextCursorKeys: CursorKey[] | null } {
  const direction = order === 'asc' ? 1 : -1
  const remaining = ordered(ROWS, keys, order).filter(
    (row) =>
      !cursorKeys ||
      direction * compareKeys(encodeKeyset(keys as KeysetKey<Row>[], row), cursorKeys) > 0
  )
  const data = remaining.slice(0, limit)
  const last = data.at(-1)
  return {
    data,
    nextCursorKeys:
      remaining.length > limit && last ? encodeKeyset(keys as KeysetKey<Row>[], last) : null,
  }
}

/** Walks every page, capped so a cursor that fails to advance cannot hang the suite. */
function walk(keys: EncodeOnly[], order: ListSortOrder, limit: number): Row[] {
  const seen: Row[] = []
  let cursorKeys: CursorKey[] | undefined
  for (let guard = 0; guard <= ROWS.length + 1; guard++) {
    const result = page(keys, order, limit, cursorKeys)
    seen.push(...result.data)
    if (result.nextCursorKeys === null) return seen
    cursorKeys = result.nextCursorKeys
  }
  throw new Error('pagination did not terminate')
}

describe('v2 keyset page boundaries', () => {
  const SORT_CASES = [
    ['name', SORTS.name],
    ['createdAt', SORTS.createdAt],
  ] as const
  const ORDERS: ListSortOrder[] = ['asc', 'desc']

  for (const [sortName, keys] of SORT_CASES) {
    for (const order of ORDERS) {
      for (const limit of [1, 2, 3, ROWS.length]) {
        it(`emits every row exactly once paging ${sortName} ${order} at limit ${limit}`, () => {
          const seen = walk(keys, order, limit)

          expect(seen).toHaveLength(ROWS.length)
          expect(new Set(seen.map((row) => row.id)).size).toBe(ROWS.length)
          expect(seen.map((row) => row.id)).toEqual(ordered(ROWS, keys, order).map((row) => row.id))
        })
      }
    }
  }

  it('reports a null nextCursor on the final page and not before', () => {
    expect(page(SORTS.name, 'asc', 3).nextCursorKeys).not.toBeNull()

    const lastPage = page(SORTS.name, 'asc', 3, page(SORTS.name, 'asc', 3).nextCursorKeys ?? [])
    expect(lastPage.nextCursorKeys).not.toBeNull()

    expect(page(SORTS.name, 'asc', ROWS.length).nextCursorKeys).toBeNull()
  })

  /**
   * Proves the harness above is capable of failing. Without a unique trailing
   * key the three rows sharing `name: 'alpha'` cannot be separated, so resuming
   * "strictly after alpha" drops the other two.
   */
  it('loses rows when the keyset has no unique trailing key', () => {
    const seen = walk(SORTS.nameWithoutTiebreaker, 'asc', 1)

    expect(seen.length).toBeLessThan(ROWS.length)
  })

  it('round-trips a cursor only under the sort that minted it', () => {
    const keys = encodeKeyset(SORTS.name as KeysetKey<Row>[], ROWS[0])
    const cursor = encodeSortedCursor(cursorSortKey('name', 'asc'), keys)

    expect(decodeSortedCursor(cursor, cursorSortKey('name', 'asc'))).toEqual({
      status: 'ok',
      keys,
    })
    expect(decodeSortedCursor(cursor, cursorSortKey('name', 'desc'))).toEqual({ status: 'invalid' })
    expect(decodeSortedCursor(cursor, cursorSortKey('createdAt', 'asc'))).toEqual({
      status: 'invalid',
    })
  })
})
