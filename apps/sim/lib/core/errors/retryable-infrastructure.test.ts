/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  describeError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'

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
    expect(described.name).toBe('Error')
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
    const described = describeError(aborted)

    expect(described.name).toBe('AbortError')
    expect(described.message).toBe('The operation was aborted')
    // The retryable classifier skips it entirely — describeError still surfaces it.
    expect(isRetryableInfrastructureError(aborted)).toBe(false)
  })

  it('falls back to a populated description for non-Error input without throwing', () => {
    expect(describeError('just a string')).toEqual({ name: 'Error', message: 'just a string' })
    expect(() => describeError({ weird: true })).not.toThrow()
  })

  it('stops walking the cause chain at depth 10 and does not loop on a cycle', () => {
    const a = new Error('a')
    const b = new Error('b')
    ;(a as Error & { cause?: unknown }).cause = b
    ;(b as Error & { cause?: unknown }).cause = a

    let described: ReturnType<typeof describeError> | undefined
    expect(() => {
      described = describeError(a)
    }).not.toThrow()
    expect(described?.causeChain?.length).toBeLessThanOrEqual(10)
  })
})
