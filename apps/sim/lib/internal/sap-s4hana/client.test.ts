import { describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithValidation } = vi.hoisted(() => ({
  mockSecureFetchWithValidation: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  MAX_JSON_API_RESPONSE_BYTES: 10 * 1024 * 1024,
  secureFetchWithValidation: mockSecureFetchWithValidation,
}))

import { fetchSapCsrf } from '@/lib/internal/sap-s4hana/client'
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
