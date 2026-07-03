/**
 * @vitest-environment node
 *
 * The v2 query/bulk filter wire format is now a PostgREST string (parsed +
 * validated server-side by `parsePostgrestFilter`). The contract only bounds the
 * string; grammar validation lives in the parser tests (`postgrest.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import {
  deleteTableRowsBodySchema,
  queryTableRowsV2BodySchema,
  updateRowsByFilterBodySchema,
} from '@/lib/api/contracts/tables'

describe('queryTableRowsV2BodySchema', () => {
  it('accepts a PostgREST filter/order string, leaves limit unbounded, has no offset', () => {
    const parsed = queryTableRowsV2BodySchema.parse({
      workspaceId: 'ws-1',
      filter: 'wins=gte.10&status=in.(active,pending)',
      order: 'wins.desc',
      cursor: 'abc',
    })
    expect(parsed.filter).toBe('wins=gte.10&status=in.(active,pending)')
    // Omitted limit stays undefined — the query returns all matching rows.
    expect(parsed.limit).toBeUndefined()
    expect('offset' in parsed).toBe(false)
  })

  it('allows omitting the filter (match all)', () => {
    expect(queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1' }).success).toBe(true)
  })

  it('rejects an empty filter string and an over-long one', () => {
    expect(queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1', filter: '' }).success).toBe(
      false
    )
    expect(
      queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1', filter: 'x'.repeat(5000) })
        .success
    ).toBe(false)
  })

  it('accepts a large explicit limit (no row cap) but rejects limit < 1', () => {
    expect(
      queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1', limit: 100000 }).success
    ).toBe(true)
    expect(queryTableRowsV2BodySchema.safeParse({ workspaceId: 'ws-1', limit: 0 }).success).toBe(
      false
    )
  })
})

describe('bulk schemas accept either a PostgREST string or the legacy filter object', () => {
  it('delete accepts a PostgREST string filter', () => {
    expect(
      deleteTableRowsBodySchema.safeParse({ workspaceId: 'ws-1', filter: 'status=eq.archived' })
        .success
    ).toBe(true)
  })

  it('delete still accepts the legacy object filter (v1 callers)', () => {
    expect(
      deleteTableRowsBodySchema.safeParse({ workspaceId: 'ws-1', filter: { status: 'archived' } })
        .success
    ).toBe(true)
  })

  it('update accepts a PostgREST string filter', () => {
    expect(
      updateRowsByFilterBodySchema.safeParse({
        workspaceId: 'ws-1',
        filter: 'wins=gte.10',
        data: { active: false },
      }).success
    ).toBe(true)
  })
})
