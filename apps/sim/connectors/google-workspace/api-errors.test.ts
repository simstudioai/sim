/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import {
  fetchGoogleApiWithRetry,
  readGoogleApiError,
} from '@/connectors/google-workspace/api-errors'

const OPERATION = 'gmail.messages.attachments.get'
const RESPONSE_SECRET = 'private-customer-data'
function failure(status: number, reason: string, headers?: Record<string, string>): Response {
  return Response.json(
    { error: { message: RESPONSE_SECRET, errors: [{ reason }] } },
    { status, headers }
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Google API diagnostics', () => {
  it.each([
    [400, 'badRequest', 'request_rejected'],
    [403, 'forbidden', 'authorization'],
    [403, 'userRateLimitExceeded', 'rate_limit'],
    [500, 'backendError', 'provider_unavailable'],
  ] as const)('retains safe %s %s evidence through wrapping', async (status, reason, category) => {
    const error = await readGoogleApiError(failure(status, reason), OPERATION)
    const diagnostic = getConnectorFailureDiagnostic(
      new Error('outer private detail', { cause: error })
    )
    expect(diagnostic).toMatchObject({ status, category, operation: OPERATION, reasons: [reason] })
    expect(JSON.stringify(diagnostic)).not.toContain(RESPONSE_SECRET)
    expect(JSON.stringify(diagnostic)).not.toContain('outer private detail')
  })

  it('omits unknown reason tokens even when they look like machine codes', async () => {
    const error = await readGoogleApiError(failure(403, RESPONSE_SECRET), OPERATION)
    expect(error.diagnostic?.reasons).toEqual([])
    expect(error.reasonsComplete).toBe(false)
    expect(JSON.stringify(error)).not.toContain(RESPONSE_SECRET)
  })

  it('reads structured ErrorInfo without its sensitive metadata', async () => {
    const error = await readGoogleApiError(
      Response.json(
        {
          error: {
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                reason: 'SERVICE_DISABLED',
                metadata: { credential: RESPONSE_SECRET },
              },
            ],
          },
        },
        { status: 403 }
      ),
      'calendar.events.list'
    )
    expect(error.diagnostic?.reasons).toEqual(['SERVICE_DISABLED'])
    expect(JSON.stringify(error)).not.toContain(RESPONSE_SECRET)
  })

  it.each(['not-json', 'x'.repeat(65 * 1024)])(
    'retains status for malformed or oversized bodies',
    async (body) => {
      const error = await readGoogleApiError(new Response(body, { status: 400 }), OPERATION)
      expect(error.status).toBe(400)
      expect(error.diagnostic?.reasons).toEqual([])
      expect(error.reasonsComplete).toBe(false)
    }
  )

  it('distinguishes a valid reasonless envelope from stripped or malformed reasons', async () => {
    const absent = await readGoogleApiError(
      Response.json({ error: { code: 403, message: RESPONSE_SECRET } }, { status: 403 }),
      'calendar.events.list'
    )
    expect(absent.reasonsComplete).toBe(true)
    expect(absent.diagnostic?.reasons).toEqual([])
    const malformed = await readGoogleApiError(
      Response.json({ error: { errors: [{ reason: 123 }] } }, { status: 403 }),
      'calendar.events.list'
    )
    expect(malformed.reasonsComplete).toBe(false)
    const mixed = await readGoogleApiError(
      Response.json(
        { error: { errors: [{ reason: 'forbidden' }, { reason: RESPONSE_SECRET }] } },
        { status: 403 }
      ),
      'calendar.events.list'
    )
    expect(mixed.diagnostic?.reasons).toEqual(['forbidden'])
    expect(mixed.reasonsComplete).toBe(false)
    expect(JSON.stringify([absent, malformed, mixed])).not.toContain(RESPONSE_SECRET)
  })

  it.each([{ error: [] }, { error: {} }, { error: { code: 401 } }])(
    'does not classify a malformed or inconsistent reasonless envelope as complete: %j',
    async (payload) => {
      const error = await readGoogleApiError(
        Response.json(payload, { status: 403 }),
        'calendar.events.list'
      )
      expect(error.reasonsComplete).toBe(false)
    }
  )

  it('retains recognized diagnostics when another part of the envelope is malformed', async () => {
    const error = await readGoogleApiError(
      Response.json(
        { error: { errors: [{ reason: 'forbidden' }], details: RESPONSE_SECRET } },
        { status: 403 }
      ),
      'calendar.events.list'
    )
    expect(error.diagnostic?.reasons).toEqual(['forbidden'])
    expect(error.reasonsComplete).toBe(false)
    expect(JSON.stringify(error)).not.toContain(RESPONSE_SECRET)
  })
})

describe('Google API retries', () => {
  it('preserves the caller admission hook and diagnoses its response', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(failure(403, 'forbidden'))
    const fetcher = vi.fn(
      (input: RequestInfo | URL, init: RequestInit, transport: typeof globalThis.fetch) =>
        transport(input, init)
    )
    vi.stubGlobal('fetch', fetch)
    await expect(
      fetchGoogleApiWithRetry(OPERATION, 'https://gmail.googleapis.com/example', {}, { fetcher })
    ).rejects.toMatchObject({
      status: 403,
      diagnostic: { operation: OPERATION, reasons: ['forbidden'] },
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    [500, 'backendError'],
    [403, 'rateLimitExceeded'],
    [429, 'userRateLimitExceeded'],
  ] as const)('retries %s %s through the bounded transport', async (status, reason) => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure(status, reason))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetch)
    const request = fetchGoogleApiWithRetry(
      OPERATION,
      'https://gmail.googleapis.com/example',
      {},
      { maxRetries: 1, initialDelayMs: 1 }
    )
    const checked = expect(request).resolves.toMatchObject({ status: 200 })
    await vi.runAllTimersAsync()
    await checked
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    [400, 'failedPrecondition'],
    [403, 'forbidden'],
    [404, 'notFound'],
  ] as const)('does not retry or suppress %s %s', async (status, reason) => {
    const fetch = vi.fn().mockResolvedValueOnce(failure(status, reason))
    vi.stubGlobal('fetch', fetch)
    await expect(
      fetchGoogleApiWithRetry(OPERATION, 'https://gmail.googleapis.com/example', {})
    ).rejects.toMatchObject({ status, diagnostic: { reasons: [reason] } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retains Retry-After without exceeding the caller retry budget', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(failure(429, 'rateLimitExceeded', { 'Retry-After': '300' }))
    vi.stubGlobal('fetch', fetch)
    await expect(
      fetchGoogleApiWithRetry(
        OPERATION,
        'https://gmail.googleapis.com/example',
        {},
        { retryBudgetMs: 1000 }
      )
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 300000 })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
