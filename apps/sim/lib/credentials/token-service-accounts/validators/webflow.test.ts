/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { validateWebflowServiceAccount } from '@/lib/credentials/token-service-accounts/validators/webflow'

const mockFetch = vi.fn()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validateWebflowServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns site display name and metadata on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        sites: [{ id: 'site123', displayName: 'Acme Marketing', shortName: 'acme-marketing' }],
      })
    )

    const result = await validateWebflowServiceAccount({ apiToken: 'wf-token' })

    expect(result).toEqual({
      displayName: 'Acme Marketing',
      auditMetadata: { webflowSiteId: 'site123' },
      storedMetadata: { siteId: 'site123', siteName: 'Acme Marketing' },
    })
    expect(mockFetch).toHaveBeenCalledWith('https://api.webflow.com/v2/sites', {
      headers: {
        Authorization: 'Bearer wf-token',
        Accept: 'application/json',
      },
    })
  })

  it('falls back to shortName when displayName is absent', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { sites: [{ id: 'site456', shortName: 'acme' }] })
    )

    const result = await validateWebflowServiceAccount({ apiToken: 'wf-token' })

    expect(result.displayName).toBe('acme')
    expect(result.storedMetadata).toEqual({ siteId: 'site456', siteName: 'acme' })
  })

  it('throws invalid_credentials on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 401 }))

    const error = await validateWebflowServiceAccount({ apiToken: 'bad' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('invalid_credentials')
    expect(error.status).toBe(401)
  })

  it('throws provider_unavailable on 500', async () => {
    mockFetch.mockResolvedValueOnce(new Response('server error', { status: 500 }))

    const error = await validateWebflowServiceAccount({ apiToken: 'wf-token' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(500)
  })

  it('throws provider_unavailable on 200 with empty sites array', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { sites: [] }))

    const error = await validateWebflowServiceAccount({ apiToken: 'wf-token' }).catch((e) => e)

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error.code).toBe('provider_unavailable')
    expect(error.status).toBe(502)
  })
})
