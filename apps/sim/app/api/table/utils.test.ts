/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableRowLimitError } from '@/lib/table/billing'
import { TableRowNotFoundError } from '@/lib/table/rows/errors'
import type { ColumnDefinition } from '@/lib/table/types'
import {
  orchestrationErrorResponse,
  orchestrationOutcomeErrorResponse,
  rootErrorMessage,
  tableFilterError,
} from '@/app/api/table/utils'

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

describe('orchestrationErrorResponse', () => {
  it('passes the plan row-limit error through as a 400', async () => {
    const response = orchestrationErrorResponse(new TableRowLimitError(10000))
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toBe(
      'This table has reached its row limit (10,000 rows) on your current plan.'
    )
  })

  it('passes a classified validation failure through as 400', async () => {
    const response = orchestrationErrorResponse(
      new OrchestrationError('validation', 'Value for column "email" must be unique')
    )
    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toBe('Value for column "email" must be unique')
  })

  it('answers the code the failure carries, not one derived from its wording', () => {
    expect(orchestrationErrorResponse(new TableRowNotFoundError())?.status).toBe(404)
    // The phrase that used to force a 400 no longer decides anything.
    expect(
      orchestrationErrorResponse(new OrchestrationError('conflict', 'Row 3: must be unique'))
        ?.status
    ).toBe(409)
  })

  it('unwraps a classified failure drizzle wrapped in a query error', () => {
    expect(
      orchestrationErrorResponse(
        wrapLikeDrizzle(new OrchestrationError('validation', 'Row 3: bad'))
      )?.status
    ).toBe(400)
  })

  it('returns null for unknown errors so callers keep their generic 500', () => {
    expect(orchestrationErrorResponse(new Error('connection refused'))).toBeNull()
    expect(orchestrationErrorResponse(wrapLikeDrizzle(new Error('deadlock detected')))).toBeNull()
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

describe('orchestrationOutcomeErrorResponse', () => {
  /**
   * Shaped like a driver fault surfacing verbatim — a statement plus its bound
   * parameters — so the assertion proves none of it reaches the response body.
   */
  const leakyMessage =
    'Failed query: delete from "user_table" where "user_table"."id" = $1 params: tbl-1'

  it('replaces an unclassified failure message with the fallback', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { success: false, error: leakyMessage, errorCode: 'internal' },
      'Failed to delete table'
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Failed to delete table' })
    expect(JSON.stringify(body)).not.toContain('Failed query')
    expect(JSON.stringify(body)).not.toContain('params:')
  })

  it('replaces an unclassified failure with no error code too', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { error: leakyMessage },
      'Failed to delete table'
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to delete table' })
  })

  it('keeps the message of a classified failure', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { error: 'A table named "Orders" already exists in this workspace', errorCode: 'conflict' },
      'Failed to rename table'
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'A table named "Orders" already exists in this workspace',
    })
  })

  it('carries the rejecting lock kind on a 423', async () => {
    const response = orchestrationOutcomeErrorResponse(
      { error: 'Table is locked against deletion', errorCode: 'locked', lock: 'delete' },
      'Failed to delete table'
    )

    expect(response.status).toBe(423)
    expect(await response.json()).toEqual({
      error: 'Table is locked against deletion',
      lock: 'delete',
    })
  })
})
