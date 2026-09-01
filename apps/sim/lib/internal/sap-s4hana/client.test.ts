/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithValidation: mockSecureFetchWithValidation,
}))

import { callSapOdata, fetchSapAccessToken, fetchSapCsrf } from '@/lib/internal/sap-s4hana/client'
import { sapS4HanaOperationInputSchema } from '@/lib/internal/sap-s4hana/schema'

function response(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
  setCookies: string[] = []
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: {
      get: vi.fn((name: string) => headers[name.toLowerCase()] ?? null),
      getSetCookie: vi.fn().mockReturnValue(setCookies),
    },
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
    arrayBuffer: vi.fn(),
    body: null,
  }
}

describe('SAP S/4HANA client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pins the response cap and forwards cancellation to the provider request', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(response({ d: { BusinessPartner: '100' } }))
    const signal = new AbortController().signal
    const input = sapS4HanaOperationInputSchema.parse({
      deploymentType: 'cloud_private',
      authType: 'basic',
      baseUrl: 'https://sap.example.com',
      username: 'user',
      password: 'password',
      service: 'API_BUSINESS_PARTNER',
      path: '/A_BusinessPartner',
      method: 'GET',
      query: { $format: 'json', $top: 10 },
    })

    await expect(callSapOdata(input, null, null, signal)).resolves.toMatchObject({ status: 200 })

    expect(mockSecureFetchWithValidation).toHaveBeenCalledWith(
      'https://sap.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner?$format=json&$top=10',
      expect.objectContaining({
        method: 'GET',
        maxResponseBytes: 10 * 1024 * 1024,
        signal,
      }),
      'baseUrl'
    )
  })

  it('forwards cancellation and the response cap to OAuth token requests', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      response({ access_token: 'access-token', expires_in: 3600 })
    )
    const signal = new AbortController().signal
    const input = sapS4HanaOperationInputSchema.parse({
      subdomain: 'token-test',
      region: 'us30',
      clientId: 'client-token-test',
      clientSecret: 'secret-token-test',
      service: 'API_BUSINESS_PARTNER',
      path: '/A_BusinessPartner',
    })

    await expect(fetchSapAccessToken(input, signal)).resolves.toBe('access-token')

    expect(mockSecureFetchWithValidation).toHaveBeenCalledWith(
      'https://token-test.authentication.us30.hana.ondemand.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        maxResponseBytes: 10 * 1024 * 1024,
        signal,
      }),
      'tokenUrl'
    )
  })

  it('forwards cancellation and preserves CSRF cookies', async () => {
    mockSecureFetchWithValidation.mockResolvedValue(
      response({}, 200, { 'x-csrf-token': 'csrf-token' }, [
        'sap-usercontext=sap-client=100; Path=/; Secure',
        'SAP_SESSIONID=session; Path=/; Secure',
      ])
    )
    const signal = new AbortController().signal
    const input = sapS4HanaOperationInputSchema.parse({
      deploymentType: 'cloud_private',
      authType: 'basic',
      baseUrl: 'https://sap.example.com',
      username: 'user',
      password: 'password',
      service: 'API_BUSINESS_PARTNER',
      path: '/A_BusinessPartner',
      method: 'POST',
    })

    await expect(fetchSapCsrf(input, null, signal)).resolves.toEqual({
      token: 'csrf-token',
      cookie: 'sap-usercontext=sap-client=100; SAP_SESSIONID=session',
    })
    expect(mockSecureFetchWithValidation).toHaveBeenCalledWith(
      'https://sap.example.com/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata',
      expect.objectContaining({
        method: 'GET',
        maxResponseBytes: 10 * 1024 * 1024,
        signal,
      }),
      'baseUrl'
    )
  })
})
