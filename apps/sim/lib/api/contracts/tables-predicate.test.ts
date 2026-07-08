/**
 * @vitest-environment node
 *
 * The v2 query/bulk filter wire format is the typed `{ all | any: [...] }`
 * predicate tree. The contract validates structure; column-level validation
 * (unknown field, json-op) runs server-side in `validate.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  deleteTableRowsBodySchema,
  rowQueryBodySchema,
  updateRowsByFilterBodySchema,
} from '@/lib/api/contracts/tables'

describe('rowQueryBodySchema', () => {
  it('accepts a predicate/sort object, leaves limit unbounded, has no offset', () => {
    const parsed = rowQueryBodySchema.parse({
      workspaceId: 'ws-1',
      predicate: {
        all: [
          { field: 'wins', op: 'gte', value: 10 },
          { field: 'status', op: 'in', value: ['active', 'pending'] },
        ],
      },
      sort: [{ field: 'wins', direction: 'desc' }],
      cursor: 'abc',
    })
    expect(parsed.predicate).toEqual({
      all: [
        { field: 'wins', op: 'gte', value: 10 },
        { field: 'status', op: 'in', value: ['active', 'pending'] },
      ],
    })
    // Omitted limit stays undefined — the query returns all matching rows.
    expect(parsed.limit).toBeUndefined()
    expect('offset' in parsed).toBe(false)
  })

  it('accepts a nested any/all predicate', () => {
    expect(
      rowQueryBodySchema.safeParse({
        workspaceId: 'ws-1',
        predicate: {
          any: [
            { field: 'status', op: 'eq', value: 'active' },
            { all: [{ field: 'wins', op: 'gte', value: 5 }] },
          ],
        },
      }).success
    ).toBe(true)
  })

  it('allows omitting the predicate (match all)', () => {
    expect(rowQueryBodySchema.safeParse({ workspaceId: 'ws-1' }).success).toBe(true)
  })

  it('rejects an unknown operator and a malformed leaf', () => {
    expect(
      rowQueryBodySchema.safeParse({
        workspaceId: 'ws-1',
        predicate: { all: [{ field: 'wins', op: 'bogus', value: 1 }] },
      }).success
    ).toBe(false)
    expect(
      rowQueryBodySchema.safeParse({
        workspaceId: 'ws-1',
        predicate: { all: [{ op: 'eq', value: 1 }] },
      }).success
    ).toBe(false)
  })

  it('accepts a large explicit limit (no row cap) but rejects limit < 1', () => {
    expect(rowQueryBodySchema.safeParse({ workspaceId: 'ws-1', limit: 100000 }).success).toBe(true)
    expect(rowQueryBodySchema.safeParse({ workspaceId: 'ws-1', limit: 0 }).success).toBe(false)
  })
})

describe('bulk schemas accept either a predicate tree or the legacy filter object', () => {
  it('delete accepts a predicate filter', () => {
    expect(
      deleteTableRowsBodySchema.safeParse({
        workspaceId: 'ws-1',
        filter: { all: [{ field: 'status', op: 'eq', value: 'archived' }] },
      }).success
    ).toBe(true)
  })

  it('delete still accepts the legacy object filter (v1 callers)', () => {
    expect(
      deleteTableRowsBodySchema.safeParse({ workspaceId: 'ws-1', filter: { status: 'archived' } })
        .success
    ).toBe(true)
  })

  it('update accepts a predicate filter', () => {
    expect(
      updateRowsByFilterBodySchema.safeParse({
        workspaceId: 'ws-1',
        filter: { all: [{ field: 'wins', op: 'gte', value: 10 }] },
        data: { active: false },
      }).success
    ).toBe(true)
  })
})
