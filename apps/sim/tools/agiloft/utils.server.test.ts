/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const { mockValidateUrlWithDNS, mockSecureFetch } = vi.hoisted(() => ({
  mockValidateUrlWithDNS: vi.fn(),
  mockSecureFetch: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mockValidateUrlWithDNS,
  secureFetchWithPinnedIP: mockSecureFetch,
}))

import { agiloftLoginPinned, executeAgiloftRequest } from '@/tools/agiloft/utils.server'

const baseParams = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: PLACEHOLDER_PASSWORD,
  table: 'contracts',
}

function mockResponse(body: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: { get: () => null, getSetCookie: () => [], toRecord: () => ({}) },
    body: null,
    text: async () => body.text ?? JSON.stringify(body.json ?? {}),
    json: async () => body.json ?? {},
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  mockValidateUrlWithDNS.mockReset()
  mockSecureFetch.mockReset()
  mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
})

describe('executeAgiloftRequest', () => {
  it('resolves DNS once, logs in, runs the operation with the bearer token, then logs out — all pinned', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(mockResponse({ json: { access_token: 'tok-1' } }))
      .mockResolvedValueOnce(mockResponse({ json: { id: 42, fields: { name: 'foo' } } }))
      .mockResolvedValueOnce(mockResponse({}))

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

    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://example.agiloft.com',
      'instanceUrl'
    )

    const calls = mockSecureFetch.mock.calls
    expect(calls).toHaveLength(3)
    // Credentials go in a form body, never the URL.
    expect(calls[0][0]).toBe('https://example.agiloft.com/ewws/EWLogin')
    expect(calls[0][2]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    const sent = new URLSearchParams(calls[0][2].body as string)
    expect(sent.get('$KB')).toBe('demo')
    expect(sent.get('$table')).toBe('contracts')
    expect(sent.get('$lang')).toBe('en')
    expect(calls[1][0]).toBe('https://example.agiloft.com/ewws/REST/demo/contracts/42')
    expect(calls[2][0]).toBe('https://example.agiloft.com/ewws/EWLogout?$KB=demo&$lang=en')

    for (const call of calls) {
      expect(call[1]).toBe('203.0.113.10')
    }
    expect(calls[1][2]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer tok-1' },
    })
  })

  it('still logs out when the operation throws', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(mockResponse({ json: { access_token: 'tok-2' } }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(mockResponse({}))

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

    expect(mockSecureFetch).toHaveBeenCalledTimes(3)
    expect(mockSecureFetch.mock.calls[2][0]).toContain('/ewws/EWLogout')
  })

  it('swallows logout failures (best-effort)', async () => {
    mockSecureFetch
      .mockResolvedValueOnce(mockResponse({ json: { access_token: 'tok-3' } }))
      .mockResolvedValueOnce(mockResponse({ json: { ok: true } }))
      .mockRejectedValueOnce(new Error('logout network error'))

    const result = await executeAgiloftRequest(
      baseParams,
      (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
      async () => ({ success: true, output: {} })
    )

    expect(result.success).toBe(true)
  })

  it('throws when login does not return an access token', async () => {
    mockSecureFetch.mockResolvedValueOnce(mockResponse({ json: {} }))

    await expect(
      executeAgiloftRequest(
        baseParams,
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow('Agiloft login did not return an access token')

    expect(mockSecureFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects an instance URL that resolves to a blocked IP without issuing any request', async () => {
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: false,
      error: 'instanceUrl resolves to a blocked IP address',
    })

    await expect(
      executeAgiloftRequest(
        { ...baseParams, instanceUrl: 'https://internal.attacker.com' },
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow(/blocked IP address/)

    expect(mockSecureFetch).not.toHaveBeenCalled()
  })
})

describe('agiloftLoginPinned token integrity', () => {
  /**
   * A token is opaque base64, so a short credential can appear inside it by
   * coincidence. Redacting the body before parsing would rewrite the token and
   * break every request that carries it, so parsing stays on the raw text.
   */
  it('returns the token intact when the password occurs inside it', async () => {
    /**
     * Deliberately not JWT-shaped: a realistic header segment reads as a real
     * token to secret scanners. All this test needs is an opaque value that
     * happens to contain the password.
     */
    const password = 'abc'
    const token = `opaque-session-value-${password}-trailing`

    mockSecureFetch.mockResolvedValueOnce(
      mockResponse({ json: { access_token: token, authentication_scheme: 'Bearer ' } })
    )

    const session = await agiloftLoginPinned({ ...baseParams, password }, '93.184.216.34')

    expect(session.token).toBe(token)
    expect(session.authorization).toBe(`Bearer ${token}`)
  })

  it('redacts the credentials from a login failure message', async () => {
    mockSecureFetch.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 500,
        text: `<html><body>Error: $login=admin&$password=${PLACEHOLDER_PASSWORD}</body></html>`,
      })
    )

    await expect(agiloftLoginPinned(baseParams, '93.184.216.34')).rejects.toThrow(/\[redacted\]/)
  })
})
