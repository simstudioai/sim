/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TableRowLimitError } from '@/lib/table/billing'
import { rootErrorMessage, rowWriteErrorResponse } from '@/app/api/table/utils'

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
