/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getPostgresErrorCode } from '@/lib/core/utils/pg-error'

describe('getPostgresErrorCode', () => {
  it('reads code from Error.code', () => {
    const err = new Error('fail') as Error & { code: string }
    err.code = '23505'
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('reads code from Error.cause', () => {
    const err = new Error('fail', { cause: { code: '23505' } })
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('returns undefined for non-errors', () => {
    expect(getPostgresErrorCode(undefined)).toBeUndefined()
    expect(getPostgresErrorCode('23505')).toBeUndefined()
  })
})
