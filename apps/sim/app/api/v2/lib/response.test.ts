/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2Error } from '@/app/api/v2/lib/response'

describe('v2Error retry guidance', () => {
  it('sends Retry-After on 503 so a client does not retry a degraded dependency immediately', () => {
    const response = v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable')

    expect(response.status).toBe(503)
    const retryAfter = response.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect(Number.isInteger(Number(retryAfter))).toBe(true)
  })

  it('lets a caller-supplied Retry-After win over the default', () => {
    const response = v2Error('SERVICE_UNAVAILABLE', 'Service temporarily unavailable', {
      headers: { 'Retry-After': '30' },
    })

    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it('does not invent Retry-After for failures a retry cannot fix', () => {
    for (const code of ['BAD_REQUEST', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT'] as const) {
      expect(v2Error(code, 'nope').headers.get('Retry-After')).toBeNull()
    }
  })

  it('does not default Retry-After on 429, whose wait comes from the token bucket', () => {
    expect(v2Error('RATE_LIMITED', 'API rate limit exceeded').headers.get('Retry-After')).toBeNull()
  })

  it('stays silent on retrying when the outcome is unknown rather than absent', () => {
    const response = v2Error(
      'SERVICE_UNAVAILABLE',
      'Async execution queue acceptance unconfirmed',
      {
        omitRetryAfter: true,
      }
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBeNull()
  })
})
