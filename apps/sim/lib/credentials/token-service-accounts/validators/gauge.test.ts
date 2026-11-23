import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it, vi } from 'vitest'
import { validateGaugeServiceAccount } from '@/lib/credentials/token-service-accounts/validators/gauge'

const credentialInfo = {
  user: null,
  apiKey: {
    id: 'key-example',
    name: 'Workflow key',
    prefix: 'gauge_sk_example',
    organization: { id: 'org-example', slug: 'example', name: 'Example' },
  },
  token: { kind: 'api_key', scopes: ['read'], expiresAt: null },
}

describe('Gauge saved API key verification', () => {
  it('records an organization principal instead of inventing a human actor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(credentialInfo)))

    const result = await validateGaugeServiceAccount({ apiToken: 'gauge_sk_test' })

    expect(result.principal).toEqual({ kind: 'tenant', id: 'org-example', label: 'Example' })
    expect(result.storedMetadata).toMatchObject({ keyId: 'key-example', scopes: '["read"]' })
  })

  it.each([
    {
      name: 'a user login token',
      value: {
        user: { id: 'user-example', name: 'Example User', email: 'user@example.test' },
        apiKey: null,
        token: { kind: 'session', scopes: ['read', 'write'], expiresAt: null },
      },
      code: 'invalid_credentials',
    },
    {
      name: 'an expired key',
      value: {
        ...credentialInfo,
        token: { ...credentialInfo.token, expiresAt: '2000-01-01T00:00:00Z' },
      },
      code: 'invalid_credentials',
    },
    {
      name: 'a successful body without an organization identity',
      value: { ...credentialInfo, apiKey: { ...credentialInfo.apiKey, organization: null } },
      code: 'provider_unavailable',
    },
  ])('rejects $name', async ({ value, code }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(value)))

    await expect(validateGaugeServiceAccount({ apiToken: 'gauge_sk_test' })).rejects.toMatchObject({
      code,
    })
  })

  it.each([
    { status: 401, code: 'invalid_credentials' },
    { status: 429, code: 'provider_unavailable' },
  ])('keeps a provider $status body out of validation errors', async ({ status, code }) => {
    const privateBody = 'private provider response with gauge_sk_test'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(privateBody, { status })))

    const error = await validateGaugeServiceAccount({ apiToken: 'gauge_sk_test' }).catch(
      (error: unknown) => error
    )

    expect(error).toMatchObject({ code })
    expect(JSON.stringify(error)).not.toContain(privateBody)
    expect(JSON.stringify(error)).not.toContain('gauge_sk_test')
  })

  it('bounds identity response bytes before parsing provider data', async () => {
    const body = JSON.stringify({ ...credentialInfo, extra: 'x'.repeat(65_536) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))

    await expect(validateGaugeServiceAccount({ apiToken: 'gauge_sk_test' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    })
  })
})
