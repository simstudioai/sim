/**
 * @vitest-environment node
 */
import { APIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'
import { getBetterAuthClientErrorStatus } from '@/lib/auth/better-auth-error'

describe('getBetterAuthClientErrorStatus', () => {
  /**
   * Built from real `APIError`s rather than stand-ins: the helper exists because the shape belongs
   * to a dependency, so a fixture agreeing with our guess would prove nothing about what the
   * routes actually catch.
   */
  it.each([
    ['BAD_REQUEST' as const, 400],
    ['UNAUTHORIZED' as const, 401],
    ['FORBIDDEN' as const, 403],
  ])('reads %s as %i', (status, expected) => {
    expect(getBetterAuthClientErrorStatus(new APIError(status, { message: 'refused' }))).toBe(
      expected
    )
  })

  it('says nothing about a server fault, an ordinary error, or a thrown non-error', () => {
    expect(
      getBetterAuthClientErrorStatus(new APIError('INTERNAL_SERVER_ERROR', { message: 'boom' }))
    ).toBeUndefined()
    expect(getBetterAuthClientErrorStatus(new Error('connection reset'))).toBeUndefined()
    expect(getBetterAuthClientErrorStatus('invalid token')).toBeUndefined()
  })
})
