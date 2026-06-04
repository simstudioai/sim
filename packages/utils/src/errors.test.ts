/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { describeError, getPostgresErrorCode, toError } from './errors.js'

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

describe('describeError', () => {
  it('reports name and message for a plain error, omitting causeChain', () => {
    const described = describeError(new Error('boom'))
    expect(described).toEqual({ name: 'Error', message: 'boom' })
    expect(described.causeChain).toBeUndefined()
  })

  it('surfaces the deepest cause for a wrapped driver error', () => {
    const driver = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      syscall: 'read',
    })
    const wrapped = new Error('Failed query: select ...', { cause: driver })
    const described = describeError(wrapped)
    expect(described.message).toBe('read ECONNRESET')
    expect(described.code).toBe('ECONNRESET')
    expect(described.errno).toBe('ECONNRESET')
    expect(described.syscall).toBe('read')
    expect(described.causeChain).toEqual([
      'Error: Failed query: select ...',
      'Error: read ECONNRESET',
    ])
  })

  it('always returns the cause for unclassified errors (AbortError)', () => {
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    expect(describeError(aborted)).toEqual({
      name: 'AbortError',
      message: 'The operation was aborted',
    })
  })

  it('falls back to a populated description for non-Error input without throwing', () => {
    expect(describeError('just a string')).toEqual({ name: 'Error', message: 'just a string' })
    expect(() => describeError({ weird: true })).not.toThrow()
  })

  it('stops at depth 10 and does not loop on a cyclic cause', () => {
    const a = new Error('a')
    const b = new Error('b')
    ;(a as { cause?: unknown }).cause = b
    ;(b as { cause?: unknown }).cause = a
    let described: ReturnType<typeof describeError> | undefined
    expect(() => {
      described = describeError(a)
    }).not.toThrow()
    expect(described?.causeChain?.length).toBeLessThanOrEqual(10)
  })
})
