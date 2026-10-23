import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mintBoxServiceAccountToken } from '@/lib/credentials/client-credential-accounts/minters/box'

const TOKEN_URL = 'https://api.box.com/oauth2/token'
const CURRENT_USER_URL = 'https://api.box.com/2.0/users/me'

const FIELDS = { clientId: 'box-cid', clientSecret: 'box-secret', orgId: '1234567' }

const mockFetch = vi.fn()

function expectMintCall(): void {
  const [url, init] = mockFetch.mock.calls[0]
  expect(url).toBe(TOKEN_URL)
  expect(init.method).toBe('POST')
  expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  const body = new URLSearchParams(init.body as string)
  expect(body.get('grant_type')).toBe('client_credentials')
  expect(body.get('client_id')).toBe('box-cid')
  expect(body.get('client_secret')).toBe('box-secret')
  expect(body.get('box_subject_type')).toBe('enterprise')
  expect(body.get('box_subject_id')).toBe('1234567')
}

function expectIdentityCall(): void {
  const [url, init] = mockFetch.mock.calls[1]
  expect(url).toBe(CURRENT_USER_URL)
  expect(init.headers.Authorization).toBe('Bearer box-access')
}

describe('mintBoxServiceAccountToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  it('mints a token and resolves the Service Account identity via users/me', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'box-access', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: '33445566',
          name: 'Sim Automation',
          login: 'AutomationUser_123_abc@boxdevedition.com',
        })
      )

    const result = await mintBoxServiceAccountToken(FIELDS)

    expect(result).toEqual({
      accessToken: 'box-access',
      expiresInSeconds: 3600,
      identity: {
        displayName: 'Sim Automation',
        principal: {
          kind: 'user',
          id: '33445566',
          label: 'AutomationUser_123_abc@boxdevedition.com',
        },
        auditMetadata: { boxEnterpriseId: '1234567' },
        storedMetadata: { enterpriseId: '1234567' },
      },
    })
    expectMintCall()
    expectIdentityCall()
  })

  it('marks the principal as lookup_failed when users/me omits the user id', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'box-access', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ name: 'Sim Automation' }))

    const result = await mintBoxServiceAccountToken(FIELDS)

    expect(result.identity?.principal).toEqual({
      kind: 'lookup_failed',
      reason: 'response missing user id',
    })
    // Only the principal degrades — a name that did come back still beats the
    // Enterprise-ID fallback, so the credential does not lose its label.
    expect(result.identity?.displayName).toBe('Sim Automation')
  })

  it('flags a wrong app type on the grant-type variant of unauthorized_client', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: 'unauthorized_client',
          error_description: 'The grant type is unauthorized for this client_id',
        },
        400
      )
    )

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'invalid_credentials',
      logDetail: expect.objectContaining({
        hint: 'app was created as user authentication (OAuth 2.0) instead of Server Authentication',
      }),
    })
  })

  it('throws provider_unavailable (not invalid_credentials) on a 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate_limit_exceeded' }, 429))

    await expect(mintBoxServiceAccountToken(FIELDS)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 429,
    })
  })
})
