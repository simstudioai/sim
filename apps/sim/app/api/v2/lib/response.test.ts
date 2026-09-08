/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InsufficientScopeError } from '@/lib/core/application'
import { HttpError } from '@/lib/core/utils/http-error'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2HttpError,
  v2RateLimitError,
} from '@/app/api/v2/lib/response'

describe('v2 403 insufficient_scope challenge', () => {
  /**
   * RFC 6750 §3.1: a token that authenticated but lacks the scope gets a 403
   * whose challenge names the scope to ask for, alongside the closed detail
   * code so a client can branch without parsing prose.
   */
  it('names the missing scope in WWW-Authenticate and the detail code', async () => {
    const response = v2CaughtOrchestrationError(new InsufficientScopeError('api:write'))

    expect(response?.status).toBe(403)
    expect(response?.headers.get('WWW-Authenticate')).toBe(
      'Bearer realm="Sim API", error="insufficient_scope", scope="api:write"'
    )
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN', details: { code: 'INSUFFICIENT_SCOPE' } },
    })
  })
})

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

/**
 * RFC 9110 §11.6.1 makes `WWW-Authenticate` a MUST on 401, and `v2Error` is the
 * one funnel every v2 401 passes through — the missing key, the invalid key, an
 * `unauthorized` orchestration failure, and the v1 middleware's auth result all
 * render here.
 */
describe('v2 401 authentication challenge', () => {
  /**
   * Pinned exactly at the primary funnel rather than asserted as merely present.
   * `toBeTruthy` accepts any string, so the scheme token, the realm, and the
   * `header=` parameter that names the only channel v2 reads could all change
   * without a test noticing. The reachability tests below stay loose on purpose
   * — they pin that the header arrives down each path, not its value twice.
   */
  const EXPECTED_CHALLENGE = 'SimApiKey realm="Sim API", header="x-api-key", Bearer realm="Sim API"'

  const challenge = () =>
    v2Error('UNAUTHORIZED', 'API key or OAuth access token required').headers.get(
      'WWW-Authenticate'
    )

  it('sends a challenge on 401', () => {
    const response = v2Error('UNAUTHORIZED', 'Invalid API key')

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(EXPECTED_CHALLENGE)
  })

  /**
   * RFC 6750 §3.1: `error="invalid_token"` only when a bearer token was
   * presented and refused. A caller that sent nothing is told what would work,
   * and the scheme it tried leads the list.
   */
  it('leads with an invalid_token bearer challenge when a bearer token was refused', () => {
    const response = v2Error('UNAUTHORIZED', 'Invalid access token', { authChallenge: 'bearer' })

    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer realm="Sim API", error="invalid_token", SimApiKey realm="Sim API", header="x-api-key"'
    )
  })

  it('never marks a bearer token invalid when none was presented', () => {
    expect(challenge()).not.toContain('invalid_token')
  })

  it('names the x-api-key header, the only channel v2 actually reads', () => {
    expect(challenge()).toContain('x-api-key')
  })

  it('does not advertise a scheme v2 does not accept', () => {
    const value = challenge() ?? ''
    const scheme = value.split(' ')[0].toLowerCase()

    expect(scheme).not.toBe('bearer')
    expect(scheme).not.toBe('basic')
    expect(scheme).not.toBe('digest')
  })

  it('challenges on a 401 reached through the rate-limit auth result', () => {
    const response = v2RateLimitError({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      limit: 0,
      error: 'Invalid API key',
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBeTruthy()
  })

  it('challenges on a 401 reached through a typed HTTP error', () => {
    class UnauthorizedError extends HttpError {
      readonly statusCode = 401
    }

    const response = v2HttpError(new UnauthorizedError('Invalid API key'))

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBeTruthy()
  })

  it('does not challenge on statuses that are not 401', () => {
    for (const code of ['BAD_REQUEST', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED'] as const) {
      expect(v2Error(code, 'nope').headers.get('WWW-Authenticate')).toBeNull()
    }
  })

  /**
   * `options.headers` is spread *after* the challenge, so a caller-supplied
   * `WWW-Authenticate` replaces the default rather than being ignored. That
   * precedence is the whole reason the default is safe to install
   * unconditionally on 401 — a route with a genuinely different challenge is
   * not fighting it — but it also means an accidental override silently wins.
   * Documented here so a reordering of the spread is a test failure either way.
   */
  it('lets a caller-supplied challenge override the default', () => {
    const response = v2Error('UNAUTHORIZED', 'Invalid token', {
      headers: { 'WWW-Authenticate': 'Bearer realm="mcp"' },
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="mcp"')
  })
})
