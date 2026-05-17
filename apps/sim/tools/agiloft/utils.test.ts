/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAgiloftRequest } from '@/tools/agiloft/utils'

const baseParams = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'demo',
  login: 'admin',
  password: 'secret',
  table: 'contracts',
}

function mockFetchResponse(body: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: new Headers(),
    text: async () => body.text ?? '',
    json: async () => body.json ?? {},
  } as unknown as Response
}

const fetchSpy = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('executeAgiloftRequest', () => {
  it('logs in, runs the operation with the bearer token, then logs out', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ json: { access_token: 'tok-1' } }))
      .mockResolvedValueOnce(mockFetchResponse({ json: { id: 42, fields: { name: 'foo' } } }))
      .mockResolvedValueOnce(mockFetchResponse({}))

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

    const calls = fetchSpy.mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[0][0]).toBe(
      'https://example.agiloft.com/ewws/EWLogin?$KB=demo&$login=admin&$password=secret'
    )
    expect(calls[1][0]).toBe('https://example.agiloft.com/ewws/REST/demo/contracts/42')
    expect(calls[1][1]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer tok-1' },
    })
    expect(calls[2][0]).toBe('https://example.agiloft.com/ewws/EWLogout?$KB=demo')
  })

  it('still calls logout when the operation throws', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ json: { access_token: 'tok-2' } }))
      .mockResolvedValueOnce(mockFetchResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(mockFetchResponse({}))

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

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[2][0]).toContain('/ewws/EWLogout')
  })

  it('swallows logout failures (best-effort)', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ json: { access_token: 'tok-3' } }))
      .mockResolvedValueOnce(mockFetchResponse({ json: { ok: true } }))
      .mockRejectedValueOnce(new Error('logout network error'))

    const result = await executeAgiloftRequest(
      baseParams,
      (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
      async () => ({ success: true, output: {} })
    )

    expect(result.success).toBe(true)
  })

  it('throws when login does not return an access token', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ json: {} }))

    await expect(
      executeAgiloftRequest(
        baseParams,
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow('Agiloft login did not return an access token')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects an instance URL that fails synchronous URL validation', async () => {
    await expect(
      executeAgiloftRequest(
        { ...baseParams, instanceUrl: 'not-a-valid-url' },
        (base) => ({ url: `${base}/ewws/REST/demo/contracts/42`, method: 'GET' }),
        async () => ({ success: true, output: {} })
      )
    ).rejects.toThrow(/Invalid Agiloft instance URL/)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
