/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
  isRetryableSetupError,
  RetryableSetupError,
} from '@/lib/core/errors/retryable-infrastructure'

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`error ${code}`), { code })
}

describe('isRetryableInfrastructureError', () => {
  it('recognizes postgres.js client connection failure codes', () => {
    for (const code of [
      'CONNECT_TIMEOUT',
      'CONNECTION_CLOSED',
      'CONNECTION_ENDED',
      'CONNECTION_DESTROYED',
    ]) {
      expect(isRetryableInfrastructureError(errorWithCode(code))).toBe(true)
    }
  })

  it('recognizes node syscall and postgres server codes', () => {
    expect(isRetryableInfrastructureError(errorWithCode('ECONNRESET'))).toBe(true)
    expect(isRetryableInfrastructureError(errorWithCode('57P01'))).toBe(true)
  })

  it('walks the cause chain to find a retryable code', () => {
    const wrapped = new Error('Failed to resolve webhook provider config', {
      cause: errorWithCode('CONNECT_TIMEOUT'),
    })
    expect(isRetryableInfrastructureError(wrapped)).toBe(true)
    expect(describeRetryableInfrastructureError(wrapped)).toMatchObject({
      code: 'CONNECT_TIMEOUT',
    })
  })

  it('does not classify semantic SQL errors as retryable', () => {
    expect(isRetryableInfrastructureError(errorWithCode('42703'))).toBe(false)
    expect(isRetryableInfrastructureError(new Error('workflow not found'))).toBe(false)
    expect(isRetryableInfrastructureError(undefined)).toBe(false)
  })
})

describe('RetryableSetupError', () => {
  it('is recognized by its guard and preserves the cause', () => {
    const cause = { code: 'CONNECT_TIMEOUT' }
    const error = new RetryableSetupError('Internal error while fetching workflow', { cause })

    expect(isRetryableSetupError(error)).toBe(true)
    expect(error.name).toBe('RetryableSetupError')
    expect(error.cause).toBe(cause)
  })

  it('does not match plain errors', () => {
    expect(isRetryableSetupError(new Error('boom'))).toBe(false)
    expect(isRetryableSetupError(undefined)).toBe(false)
  })
})
