/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parsePlaidServiceAccountSecretBlob,
  validatePlaidServiceAccount,
} from '@/lib/credentials/plaid-service-account'
import { TokenServiceAccountValidationError } from '@/lib/credentials/token-service-accounts/errors'

const mockFetch = vi.fn()

const fields = {
  clientId: 'client-id',
  clientSecret: 'environment-secret',
  environment: 'production' as const,
  accessToken: 'access-production-item',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('validatePlaidServiceAccount', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  it.each([
    ['production', 'https://production.plaid.com/item/get'],
    ['sandbox', 'https://sandbox.plaid.com/item/get'],
  ] as const)('verifies a %s Item against the fixed environment host', async (environment, url) => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        item: { item_id: 'item-1', institution_id: 'ins_123' },
      })
    )

    const result = await validatePlaidServiceAccount({ ...fields, environment })

    expect(result).toEqual({
      itemId: 'item-1',
      institutionId: 'ins_123',
      displayName: 'Plaid ins_123 (item-1)',
      principal: { kind: 'tenant', id: 'item-1', label: 'ins_123' },
      auditMetadata: {
        plaidItemId: 'item-1',
        plaidEnvironment: environment,
        plaidInstitutionId: 'ins_123',
      },
    })
    const [requestedUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(requestedUrl).toBe(url)
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({
      'PLAID-CLIENT-ID': fields.clientId,
      'PLAID-SECRET': fields.clientSecret,
      'Plaid-Version': '2020-09-14',
    })
    expect(JSON.parse(String(init.body))).toEqual({ access_token: fields.accessToken })
  })

  it('rejects an unknown environment before making a request', async () => {
    await expect(
      validatePlaidServiceAccount({
        ...fields,
        environment: 'development' as 'production',
      })
    ).rejects.toMatchObject({
      name: 'TokenServiceAccountValidationError',
      code: 'invalid_credentials',
      status: 400,
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('classifies Plaid credential failures without retaining secret values', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(400, {
        error_code: 'INVALID_ACCESS_TOKEN',
        error_message: `rejected ${fields.clientSecret} ${fields.accessToken}`,
      })
    )

    let error: TokenServiceAccountValidationError | undefined
    try {
      await validatePlaidServiceAccount(fields)
    } catch (caught) {
      error = caught as TokenServiceAccountValidationError
    }

    expect(error).toBeInstanceOf(TokenServiceAccountValidationError)
    expect(error).toMatchObject({
      code: 'invalid_credentials',
      status: 400,
      logDetail: {
        step: 'plaid_item_get',
        environment: 'production',
        plaidErrorCode: 'INVALID_ACCESS_TOKEN',
      },
    })
    expect(JSON.stringify(error?.logDetail)).not.toContain(fields.clientSecret)
    expect(JSON.stringify(error?.logDetail)).not.toContain(fields.accessToken)
  })

  it.each([429, 503])('maps HTTP %s to provider_unavailable', async (status) => {
    mockFetch.mockResolvedValueOnce(jsonResponse(status, { error_code: 'INTERNAL_SERVER_ERROR' }))

    await expect(validatePlaidServiceAccount(fields)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status,
    })
  })

  it('fails closed when a successful response has no Item id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { item: { institution_id: 'ins_123' } }))

    await expect(validatePlaidServiceAccount(fields)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: {
        step: 'plaid_item_get',
        reason: 'provider response did not contain item.item_id',
      },
    })
  })

  it('maps malformed provider JSON and network failures to provider_unavailable', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 200 }))
    await expect(validatePlaidServiceAccount(fields)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
    })

    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(validatePlaidServiceAccount(fields)).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: { reason: 'network error reaching provider' },
    })
  })

  it('rejects an oversized validation response from Content-Length before reading its body', async () => {
    const getReader = vi.fn(() => {
      throw new Error('oversized body should not be read')
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Length': String(1024 * 1024 + 1) }),
      body: { getReader },
    } as unknown as Response)

    let error: TokenServiceAccountValidationError | undefined
    try {
      await validatePlaidServiceAccount(fields)
    } catch (caught) {
      error = caught as TokenServiceAccountValidationError
    }

    expect(error).toMatchObject({
      code: 'provider_unavailable',
      status: 502,
      logDetail: {
        step: 'plaid_item_get',
        reason: 'provider returned an invalid or oversized response',
      },
    })
    expect(getReader).not.toHaveBeenCalled()
    expect(JSON.stringify(error?.logDetail)).not.toContain(fields.clientSecret)
    expect(JSON.stringify(error?.logDetail)).not.toContain(fields.accessToken)
  })
})

describe('parsePlaidServiceAccountSecretBlob', () => {
  const blob = {
    type: 'plaid_service_account',
    providerId: 'plaid-service-account',
    clientId: 'client-id',
    clientSecret: 'secret',
    environment: 'sandbox',
    accessToken: 'access-sandbox-token',
    itemId: 'item-1',
    institutionId: 'ins_123',
    metadata: { principalKind: 'tenant', ignored: 123 },
  }

  it('parses the exact provider blob and drops non-string metadata', () => {
    expect(parsePlaidServiceAccountSecretBlob(JSON.stringify(blob))).toEqual({
      ...blob,
      metadata: { principalKind: 'tenant' },
    })
  })

  it.each([
    ['wrong discriminator', { ...blob, type: 'token_service_account' }],
    ['wrong provider', { ...blob, providerId: 'other-service-account' }],
    ['unknown environment', { ...blob, environment: 'development' }],
    ['missing access token', { ...blob, accessToken: '' }],
    ['missing Item id', { ...blob, itemId: '' }],
  ])('rejects a %s', (_name, invalidBlob) => {
    expect(() => parsePlaidServiceAccountSecretBlob(JSON.stringify(invalidBlob))).toThrow(
      'Stored Plaid service-account secret is malformed'
    )
  })

  it('rejects malformed JSON', () => {
    expect(() => parsePlaidServiceAccountSecretBlob('{')).toThrow(
      'Stored Plaid service-account secret is malformed'
    )
  })
})
