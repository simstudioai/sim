/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TableRowLimitError } from '@/lib/table/billing'
import type { ColumnDefinition } from '@/lib/table/types'
import { rootErrorMessage, rowWriteErrorResponse, tableFilterError } from '@/app/api/table/utils'

/** Mimics drizzle's DrizzleQueryError: message is the failed SQL, real error on `cause`. */
function wrapLikeDrizzle(cause: Error): Error {
  return new Error('Failed query: insert into "user_table_rows" ...', { cause })
}

describe('rootErrorMessage', () => {
  it('returns the message of a plain error', () => {
    expect(rootErrorMessage(new Error('Schema validation failed: bad'))).toBe(
      'Schema validation failed: bad'
    )
  })

  it('unwraps the cause chain to the deepest error', () => {
    const root = new Error('Value for column "email" must be unique')
    expect(rootErrorMessage(wrapLikeDrizzle(root))).toBe(root.message)
  })

  it('stringifies non-Error values', () => {
    expect(rootErrorMessage('boom')).toBe('boom')
  })
})

describe('rowWriteErrorResponse', () => {
  it('passes the plan row-limit error through as a 400', async () => {
    const response = rowWriteErrorResponse(new TableRowLimitError(10000))
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toBe(
      'This table has reached its row limit (10,000 rows) on your current plan.'
    )
  })

  it('passes known validation messages through as 400', async () => {
    const response = rowWriteErrorResponse(new Error('Value for column "email" must be unique'))
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toBe('Value for column "email" must be unique')
  })

  it('matches per-row batch validation messages', () => {
    expect(rowWriteErrorResponse(new Error('Row 3: name is required'))?.status).toBe(400)
  })

  it('returns null for unknown errors so callers keep their generic 500', () => {
    expect(rowWriteErrorResponse(new Error('connection refused'))).toBeNull()
    expect(rowWriteErrorResponse(wrapLikeDrizzle(new Error('deadlock detected')))).toBeNull()
  })
})

/**
 * The async destructive routes (delete-async, cancel-runs, columns/run)
 * validate the WIRE filter here. The predicate branch must reject unknown
 * storage keys the way the sync bulk routes do — the `toLegacyFilter`
 * downgrade compiles a typo'd field into a clause that silently matches
 * nothing, turning a scoped delete/run into a no-op.
 */
describe('tableFilterError', () => {
  const columns: ColumnDefinition[] = [{ id: 'col_status', name: 'status', type: 'string' }]

  it('returns null for an absent filter and a valid id-keyed predicate', () => {
    expect(tableFilterError(undefined, columns)).toBeNull()
    expect(
      tableFilterError({ all: [{ field: 'col_status', op: 'eq', value: 'x' }] }, columns)
    ).toBeNull()
    expect(tableFilterError({ all: [{ field: 'createdAt', op: 'isNotNull' }] }, columns)).toBeNull()
  })

  it('400s a predicate naming an unknown storage key', async () => {
    const response = tableFilterError(
      { all: [{ field: 'statuss', op: 'eq', value: 'x' }] },
      columns
    )
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toMatch(/Unknown filter column "statuss"/)
  })

  it('400s a structurally invalid predicate (empty group, dual group keys)', () => {
    expect(tableFilterError({ all: [] } as never, columns)?.status).toBe(400)
    expect(
      tableFilterError(
        {
          all: [{ field: 'col_status', op: 'eq', value: 'a' }],
          any: [{ field: 'col_status', op: 'eq', value: 'b' }],
        } as never,
        columns
      )?.status
    ).toBe(400)
  })

  it('still validates the legacy grammar through buildFilterClause', () => {
    expect(tableFilterError({ col_status: 'x' }, columns)).toBeNull()
    expect(tableFilterError({ col_status: { $regex: 'x' } } as never, columns)?.status).toBe(400)
  })
})
