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
  predicateSchema,
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

/**
 * The predicate tree is parsed by a recursive `z.lazy` union. A few thousand
 * nested groups overflow the stack inside `safeParse`, and a `RangeError`
 * escaping a parser is a 500 on a public endpoint, not a 400.
 */
describe('predicate depth / size guard', () => {
  it('rejects a deeply nested tree with a validation issue, not a RangeError', () => {
    let node: unknown = { all: [{ field: 'a', op: 'eq', value: 1 }] }
    for (let i = 0; i < 5000; i++) node = { all: [node] }

    const result = predicateSchema.safeParse(node)

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/nesting is too deep/)
  })

  it('rejects a wide-but-shallow tree past the node cap', () => {
    const node = {
      all: Array.from({ length: 60 }, () => ({
        all: Array.from({ length: 60 }, () => ({ field: 'a', op: 'eq', value: 1 })),
      })),
    }

    const result = predicateSchema.safeParse(node)

    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toMatch(/too many conditions/)
  })

  it('still accepts a realistic nested predicate', () => {
    expect(
      predicateSchema.safeParse({
        all: [
          { field: 'status', op: 'eq', value: 'active' },
          {
            any: [
              { field: 'wins', op: 'gte', value: 10 },
              { field: 'name', op: 'contains', value: 'jo' },
            ],
          },
        ],
      }).success
    ).toBe(true)
  })
})
