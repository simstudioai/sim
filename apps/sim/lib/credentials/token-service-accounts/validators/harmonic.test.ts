/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTokenServiceAccountDescriptor,
  HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'
import { getTokenServiceAccountValidator } from '@/lib/credentials/token-service-accounts/server'
import { validateHarmonicServiceAccount } from '@/lib/credentials/token-service-accounts/validators/harmonic'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'

const mockFetch = vi.fn()
const API_KEY = 'harmonic-team-key-abcdefghijklmnop'

async function expectValidationError(
  promise: Promise<unknown>,
  code: 'invalid_credentials' | 'provider_unavailable'
): Promise<TokenServiceAccountValidationError> {
  const error = await promise.then(
    () => {
      throw new Error('expected validation to throw')
    },
    (cause: unknown) => cause
  )
  expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
  expect((error as TokenServiceAccountValidationError).code).toBe(code)
  return error as TokenServiceAccountValidationError
}

describe('validateHarmonicServiceAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates with the fixed saved-search endpoint and returns no inferred principal', async () => {
    const response = new Response('{not-json', { status: 200 })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    const result = await validateHarmonicServiceAccount({ apiToken: API_KEY })

    expect(mockFetch).toHaveBeenCalledWith('https://api.harmonic.ai/savedSearches', {
      headers: {
        apikey: API_KEY,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(result).toEqual({
      displayName: 'Harmonic (…mnop)',
      principal: null,
      auditMetadata: {},
    })
  })

  it.each([401, 403])('maps HTTP %i to invalid_credentials', async (status) => {
    const response = new Response(`denied ${API_KEY}`, { status })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'invalid_credentials'
    )

    expect(error.status).toBe(status)
    expect(cancel).toHaveBeenCalledOnce()
    expect(JSON.stringify(error)).not.toContain(API_KEY)
  })

  it.each([201, 204])('rejects undocumented successful HTTP %i responses', async (status) => {
    mockFetch.mockResolvedValue(new Response(status === 204 ? null : '{}', { status }))

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'provider_unavailable'
    )

    expect(error.status).toBe(status)
    expect(JSON.stringify(error)).not.toContain(API_KEY)
  })

  it('maps provider failures to provider_unavailable without retaining the response body', async () => {
    const response = new Response(`upstream echoed ${API_KEY}`, { status: 500 })
    const cancel = vi.spyOn(response.body!, 'cancel')
    mockFetch.mockResolvedValue(response)

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'provider_unavailable'
    )

    expect(error.status).toBe(500)
    expect(cancel).toHaveBeenCalledOnce()
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.logDetail).toEqual({
      step: 'saved_searches',
      reason: 'provider returned HTTP 500',
    })
  })

  it('maps a network outage to provider_unavailable without leaking the key', async () => {
    mockFetch.mockRejectedValue(new TypeError(`request with ${API_KEY} failed`))

    const error = await expectValidationError(
      validateHarmonicServiceAccount({ apiToken: API_KEY }),
      'provider_unavailable'
    )

    expect(error.status).toBe(502)
    expect(JSON.stringify(error)).not.toContain(API_KEY)
    expect(error.logDetail).toEqual({
      step: 'saved_searches',
      reason: 'network error reaching provider',
    })
  })
})

describe('Harmonic token-service-account registration', () => {
  it('keeps the descriptor, validator, and OAuth service metadata in parity', () => {
    expect(getTokenServiceAccountDescriptor(HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID)).toEqual({
      providerId: HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
      serviceLabel: 'Harmonic',
      tokenNoun: 'team API key',
      connectNoun: 'API key',
      fields: [
        {
          id: 'apiToken',
          label: 'Team API key',
          placeholder: 'Paste Harmonic team API key',
          secret: true,
        },
      ],
      docsUrl: 'https://docs.sim.ai/integrations/harmonic',
    })
    expect(getTokenServiceAccountValidator(HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID)).toBe(
      validateHarmonicServiceAccount
    )
    expect(OAUTH_PROVIDERS.harmonic.services.harmonic).toMatchObject({
      providerId: 'harmonic',
      serviceAccountProviderId: HARMONIC_SERVICE_ACCOUNT_PROVIDER_ID,
      authType: 'service_account',
      scopes: [],
    })
  })
})
