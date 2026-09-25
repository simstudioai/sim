import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { redactDatabaseQueryError } from '@/lib/core/errors/database-query-error'

const BOUND_VALUE = 'confidential user text'

function queryError(code: string, message: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "t" values ($1)',
    [BOUND_VALUE],
    Object.assign(new Error(message), { code })
  )
}

describe('redactDatabaseQueryError', () => {
  it('reports a query failure by code and known cancellation reason only', () => {
    const original = queryError('57014', 'canceling statement due to statement timeout')
    const redacted = redactDatabaseQueryError(new Error('wrapper', { cause: original }), 'Insert')
    expect(redacted).toBeInstanceOf(Error)
    expect((redacted as Error).message).toBe('Insert failed (57014, statement_timeout)')
    expect((redacted as Error).stack).not.toContain(BOUND_VALUE)
  })
  it('omits an unrecognized reason', () => {
    const redacted = redactDatabaseQueryError(
      queryError('23505', `duplicate key value ${BOUND_VALUE}`),
      'Insert'
    )
    expect((redacted as Error).message).toBe('Insert failed (23505)')
  })
  it('returns errors without a query unchanged', () => {
    const error = new Error('storage unavailable')
    expect(redactDatabaseQueryError(error, 'Insert')).toBe(error)
  })
})
