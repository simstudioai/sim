/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { executeAgiloftRequest, resolveAgiloftInstance } from '@/tools/agiloft/utils'

const baseParams = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: 'secret',
  table: 'contracts',
}

const PINNED_IP = '93.184.216.34'

function mockSecureFetchResponse(body: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  arrayBuffer?: ArrayBuffer
}) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => body.text ?? '',
    json: async () => body.json ?? {},
    arrayBuffer: async () => body.arrayBuffer ?? new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'example.agiloft.com',
  })
})

describe('resolveAgiloftInstance', () => {
  it('returns the resolved IP for a valid URL', async () => {
    const ip = await resolveAgiloftInstance('https://example.agiloft.com')
    expect(ip).toBe(PINNED_IP)
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://example.agiloft.com',
      'instanceUrl'
    )
  })

  it('throws when the URL resolves to a blocked IP', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: false,
      error: 'instanceUrl resolves to a blocked IP address',
    })

    await expect(resolveAgiloftInstance('https://attacker.example.com')).rejects.toThrow(
      'instanceUrl resolves to a blocked IP address'
    )
  })

  it('throws when validation succeeds but no IP is returned', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: true,
    })

    await expect(resolveAgiloftInstance('https://example.agiloft.com')).rejects.toThrow(
      'Invalid Agiloft instance URL'
    )
  })
})

describe('executeAgiloftRequest', () => {
  it('pins the resolved IP across login, operation, and logout', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      // EWLogin
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-1' } }))
      // operation
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { id: 42, fields: { name: 'foo' } } }))
      // EWLogout
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    const result = await executeAgiloftRequest(
      baseParams,
      (base) => ({
        url: `${base}/ewws/REST/demo/contracts/42`,
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
      async (response) => {
        const data = (await response.json()) as { id: number; fields: Record<string, unknown> }
        return {
          success: response.ok,
          output: { id: String(data.id), fields: data.fields },
        }
      }
    )

    expect(result).toEqual({ success: true, output: { id: '42', fields: { name: 'foo' } } })

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(3)

    // Every call MUST use the pre-resolved IP — this is the SSRF fix.
    for (const call of calls) {
      expect(call[1]).toBe(PINNED_IP)
    }

    // Login URL preserves the original hostname (TLS SNI requirement).
    expect(calls[0][0]).toBe(
      'https://example.agiloft.com/ewws/EWLogin?$KB=demo&$login=admin&$password=secret'
    )
    expect(calls[0][2]).toEqual({ method: 'POST' })

    // Operation request includes the bearer token issued by login.
    expect(calls[1][0]).toBe('https://example.agiloft.com/ewws/REST/demo/contracts/42')
    expect(calls[1][2]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer tok-1' },
    })

    // Logout uses the bearer token and the original hostname.
    expect(calls[2][0]).toBe('https://example.agiloft.com/ewws/EWLogout?$KB=demo')
    expect(calls[2][2]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer tok-1' },
    })

    // DNS lookup happens exactly once, before any HTTP request.
    expect(inputValidationMockFns.mockValidateUrlWithDNS).toHaveBeenCalledTimes(1)
  })

  it('still calls logout when the operation throws', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-2' } }))
      .mockResolvedValueOnce(mockSecureFetchResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(mockSecureFetchResponse({}))

    await expect(
      executeAgiloftRequest(
        baseParams,
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async (response) => {
          if (!response.ok) throw new Error('operation failed')
          return { success: true, output: {} }
        }
      )
    ).rejects.toThrow('operation failed')

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(3)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[2][0]).toContain(
      '/ewws/EWLogout'
    )
  })

  it('swallows logout failures (best-effort)', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { access_token: 'tok-3' } }))
      .mockResolvedValueOnce(mockSecureFetchResponse({ json: { ok: true } }))
      .mockRejectedValueOnce(new Error('logout network error'))

    const result = await executeAgiloftRequest(
      baseParams,
      (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
      async () => ({ success: true, output: {} })
    )

    expect(result.success).toBe(true)
  })

  it('throws when login does not return an access token', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ json: {} })
    )
    // Login failure should still trigger no logout, since no token was issued.

    await expect(
      executeAgiloftRequest(
        baseParams,
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow('Agiloft login did not return an access token')

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
  })

  it('refuses to call any external endpoint when validation rejects the URL', async () => {
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValueOnce({
      isValid: false,
      error: 'instanceUrl resolves to a blocked IP address',
    })

    await expect(
      executeAgiloftRequest(
        { ...baseParams, instanceUrl: 'https://attacker.example.com' },
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow('instanceUrl resolves to a blocked IP address')

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
