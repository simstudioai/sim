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
  it('retains the Calendar account-status reason without retaining the response message', async () => {
    const error = await readGoogleApiError(failure(403, 'notACalendarUser'), 'calendar.events.list')
    expect(error.reasonsComplete).toBe(true)
    expect(error.rateLimited).toBe(false)
    expect(getConnectorFailureDiagnostic(error)).toMatchObject({
      status: 403,
      operation: 'calendar.events.list',
      reasons: ['notACalendarUser'],
      reasonState: 'present',
    })
    expect(JSON.stringify(error)).not.toContain(RESPONSE_SECRET)
  })

  it('omits unknown reason tokens even when they look like machine codes', async () => {
    const error = await readGoogleApiError(failure(403, RESPONSE_SECRET), OPERATION)
    expect(error.diagnostic?.reasons).toEqual([])
    expect(error.reasonsComplete).toBe(false)
    expect(getConnectorFailureDiagnostic(error)?.reasonState).toBe('filtered')
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
    expect(getConnectorFailureDiagnostic(absent)?.reasonState).toBe('absent')
    const malformed = await readGoogleApiError(
      Response.json({ error: { errors: [{ reason: 123 }] } }, { status: 403 }),
      'calendar.events.list'
    )
    expect(malformed.reasonsComplete).toBe(false)
    expect(getConnectorFailureDiagnostic(malformed)?.reasonState).toBe('malformed')
    const mixed = await readGoogleApiError(
      Response.json(
        { error: { errors: [{ reason: 'forbidden' }, { reason: RESPONSE_SECRET }] } },
        { status: 403 }
      ),
      'calendar.events.list'
    )
    expect(mixed.diagnostic?.reasons).toEqual(['forbidden'])
    expect(mixed.reasonsComplete).toBe(false)
    expect(getConnectorFailureDiagnostic(mixed)?.reasonState).toBe('filtered')
    expect(JSON.stringify([absent, malformed, mixed])).not.toContain(RESPONSE_SECRET)
  })

  it('retains classification evidence beyond the diagnostic reason limit', async () => {
    const reasons = [
      'accessNotConfigured',
      'appNotAuthorizedToFile',
      'authError',
      'badRequest',
      'cannotDownloadFile',
      'cannotExportFile',
      'domainPolicy',
      'download_restricted_for_revision',
      'exportSizeLimitExceeded',
      'failedPrecondition',
      'fileNotDownloadable',
      'fileNotExportable',
      'forbidden',
      'insufficientFilePermissions',
      'insufficientPermissions',
      'invalid',
      'rateLimitExceeded',
    ]
    const error = await readGoogleApiError(
      Response.json(
        {
          error: { errors: reasons.map((reason) => ({ reason })) },
        },
        { status: 403 }
      ),
      OPERATION
    )
    expect(error.rateLimited).toBe(true)
    expect(error.reasonsComplete).toBe(false)
    expect(error.diagnostic?.reasonState).toBe('filtered')
    expect(error.diagnostic?.reasons).toHaveLength(16)
  })
})

describe('Google API retries', () => {
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
