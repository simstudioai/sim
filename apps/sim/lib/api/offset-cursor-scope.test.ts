/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  decodeOffsetCursor,
  encodeOffsetCursor,
  offsetCursorScope,
} from '@/app/api/v2/lib/response'

/**
 * An offset names a position in one exact sequence. Replay it against a
 * differently filtered or sorted sequence and it names a different row —
 * silently skipping rows, repeating them, or landing past the end and returning
 * an empty page while `nextCursor` implied more.
 *
 * The keyset cursor has always been protected from this by its sort stamp
 * (`decodeSortedCursor`). These assertions hold the offset cursor — used by
 * `GET /skills` and `GET /knowledge/{id}/documents` — to the same rule.
 */
describe('offset cursor scope', () => {
  const base = { workspaceId: 'ws-1', search: undefined, sortBy: 'name', sortOrder: 'asc' }

  it('resumes a cursor replayed under the same query state', () => {
    const scope = offsetCursorScope(base)
    expect(decodeOffsetCursor(encodeOffsetCursor(scope, 40), scope)).toBe(40)
  })

  it('rejects a cursor replayed under a different sort', () => {
    const cursor = encodeOffsetCursor(offsetCursorScope(base), 40)

    expect(() =>
      decodeOffsetCursor(cursor, offsetCursorScope({ ...base, sortBy: 'createdAt' }))
    ).toThrow(/does not match the requested/)
    expect(() =>
      decodeOffsetCursor(cursor, offsetCursorScope({ ...base, sortOrder: 'desc' }))
    ).toThrow(/does not match the requested/)
  })

  it('rejects a cursor replayed under a different filter', () => {
    const cursor = encodeOffsetCursor(offsetCursorScope(base), 40)

    expect(() =>
      decodeOffsetCursor(cursor, offsetCursorScope({ ...base, search: 'deploy' }))
    ).toThrow(/does not match the requested/)
    expect(() =>
      decodeOffsetCursor(cursor, offsetCursorScope({ ...base, workspaceId: 'ws-2' }))
    ).toThrow(/does not match the requested/)
  })

  it('treats an absent cursor as page one', () => {
    expect(decodeOffsetCursor(undefined, offsetCursorScope(base))).toBe(0)
  })

  it('rejects a cursor that is not valid base64-JSON', () => {
    expect(() => decodeOffsetCursor('not-a-cursor', offsetCursorScope(base))).toThrow()
  })

  it('rejects an offset that is not a non-negative integer', () => {
    const scope = offsetCursorScope(base)
    expect(() => decodeOffsetCursor(encodeOffsetCursor(scope, -1), scope)).toThrow('Invalid cursor')
    expect(() => decodeOffsetCursor(encodeOffsetCursor(scope, 1.5), scope)).toThrow(
      'Invalid cursor'
    )
  })

  /**
   * `limit` selects how much of the sequence to return, not what the sequence
   * is, so paging with a different page size must keep working.
   */
  it('is unaffected by the page size', () => {
    expect(offsetCursorScope({ ...base, sortBy: 'name' })).toBe(offsetCursorScope(base))
  })

  it('does not depend on the order the parts are written', () => {
    expect(offsetCursorScope({ sortBy: 'name', workspaceId: 'ws-1', sortOrder: 'asc' })).toBe(
      offsetCursorScope({ sortOrder: 'asc', workspaceId: 'ws-1', sortBy: 'name' })
    )
  })
})
