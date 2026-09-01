/**
 * @vitest-environment node
 */
import type { PgColumn } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  decodeTimeCursor,
  encodeTimeCursor,
  timeCursorPredicate,
} from '@/lib/data-drains/sources/cursor'

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

describe('timeCursorPredicate', () => {
  const timestampCol = { name: 'created_at' } as unknown as PgColumn
  const idCol = { name: 'id' } as unknown as PgColumn

  it('returns undefined without a cursor', () => {
    expect(timeCursorPredicate(timestampCol, idCol, null)).toBeUndefined()
  })

  it('binds the cursor timestamp through the column encoder', () => {
    const predicate = timeCursorPredicate(timestampCol, idCol, {
      ts: '2026-01-01T00:00:00.000Z',
      id: 'row-1',
    }) as unknown as { values: unknown[] }

    expect(predicate.values).not.toContainEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(predicate.values).toContainEqual(
      expect.objectContaining({ value: new Date('2026-01-01T00:00:00.000Z') })
    )
  })
})
