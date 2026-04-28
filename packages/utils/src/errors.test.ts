/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getPostgresErrorCode, toError } from './errors.js'

describe('toError', () => {
  it('returns the same Error when given an Error', () => {
    const err = new Error('test')
    expect(toError(err)).toBe(err)
  })

  it('wraps a string into an Error', () => {
    const err = toError('msg')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('msg')
  })

  it('wraps a number into an Error', () => {
    const err = toError(42)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('42')
  })

  it('wraps null into an Error', () => {
    const err = toError(null)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('null')
  })

  it('wraps undefined into an Error', () => {
    const err = toError(undefined)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('undefined')
  })
})

describe('getPostgresErrorCode', () => {
  it('reads code from Error.code', () => {
    const err = new Error('fail') as Error & { code: string }
    err.code = '23505'
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('reads code from plain object', () => {
    expect(getPostgresErrorCode({ code: '23505' })).toBe('23505')
  })

  it('reads code from Error.cause', () => {
    const err = new Error('fail', { cause: { code: '23505' } })
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('walks nested Error causes', () => {
    const pgErr = new Error('unique_violation') as Error & { code: string }
    pgErr.code = '23505'
    const err = new Error('outer', { cause: new Error('inner', { cause: pgErr }) })
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('returns undefined for non-errors', () => {
    expect(getPostgresErrorCode(undefined)).toBeUndefined()
    expect(getPostgresErrorCode(null)).toBeUndefined()
    expect(getPostgresErrorCode('23505')).toBeUndefined()
  })

  it('returns undefined when no code is present', () => {
    expect(getPostgresErrorCode(new Error('no code'))).toBeUndefined()
  })

  it('does not loop forever on circular cause chains', () => {
    const err1 = new Error('a')
    const err2 = new Error('b', { cause: err1 })
    // Create circular reference
    ;(err1 as { cause?: unknown }).cause = err2
    expect(getPostgresErrorCode(err1)).toBeUndefined()
  })
})
