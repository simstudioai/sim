/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  queryTableRowsV2BodySchema,
  sortSpecSchema,
  tablePredicateSchema,
} from '@/lib/api/contracts/tables'

describe('tablePredicateSchema', () => {
  it('accepts a nested all/any tree', () => {
    const parsed = tablePredicateSchema.safeParse({
      all: [
        { field: 'slack_user_id', op: 'in', value: ['U1', 'U2'] },
        {
          any: [
            { field: 's', op: 'eq', value: 'a' },
            { field: 's', op: 'eq', value: 'b' },
          ],
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a valueless op without a value', () => {
    expect(tablePredicateSchema.safeParse({ all: [{ field: 'n', op: 'isEmpty' }] }).success).toBe(
      true
    )
  })

  it('rejects an unknown operator', () => {
    expect(
      tablePredicateSchema.safeParse({ all: [{ field: 'n', op: 'regex', value: 'x' }] }).success
    ).toBe(false)
  })

  it('rejects an empty group', () => {
    expect(tablePredicateSchema.safeParse({ all: [] }).success).toBe(false)
  })

  it('rejects a node that is neither a leaf nor a group', () => {
    expect(tablePredicateSchema.safeParse({ all: [{ foo: 'bar' }] }).success).toBe(false)
  })
})

describe('queryTableRowsV2BodySchema', () => {
  it('defaults limit and accepts predicate + cursor (no offset)', () => {
    const parsed = queryTableRowsV2BodySchema.parse({
      workspaceId: 'ws-1',
      predicate: { all: [{ field: 'wins', op: 'gte', value: 10 }] },
      cursor: 'abc',
    })
    expect(parsed.limit).toBeGreaterThan(0)
    expect('offset' in parsed).toBe(false)
  })

  it('rejects limit over the max', () => {
    expect(
      queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1', limit: 100000 }).success
    ).toBe(false)
  })
})

describe('sortSpecSchema', () => {
  it('accepts an ordered field/direction list', () => {
    expect(sortSpecSchema.safeParse([{ field: 'wins', direction: 'desc' }]).success).toBe(true)
  })

  it('rejects a bad direction', () => {
    expect(sortSpecSchema.safeParse([{ field: 'wins', direction: 'sideways' }]).success).toBe(false)
  })
})
