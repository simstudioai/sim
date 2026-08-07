/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockFetch } = vi.hoisted(() => ({
  mockEnv: {
    QUICKBOOKS_CLIENT_ID: 'quickbooks-client-id' as string | undefined,
    QUICKBOOKS_CLIENT_SECRET: 'quickbooks-client-secret' as string | undefined,
  },
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))

import { revokeQuickBooksToken } from '@/lib/oauth/quickbooks'

describe('revokeQuickBooksToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.QUICKBOOKS_CLIENT_ID = 'quickbooks-client-id'
    mockEnv.QUICKBOOKS_CLIENT_SECRET = 'quickbooks-client-secret'
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the token to the Intuit revocation endpoint with client authentication', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))

    await expect(revokeQuickBooksToken(' refresh-token ')).resolves.toBeUndefined()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://developer.api.intuit.com/v2/oauth2/tokens/revoke')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(
          'quickbooks-client-id:quickbooks-client-secret'
        ).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: 'refresh-token' }),
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects before sending when client credentials are missing', async () => {
    mockEnv.QUICKBOOKS_CLIENT_SECRET = undefined

    await expect(revokeQuickBooksToken('refresh-token')).rejects.toThrow(
      'QuickBooks OAuth client credentials are not configured'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sanitizes network and timeout failures', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('request timed out', 'AbortError'))

    const result = revokeQuickBooksToken('sensitive-refresh-token')
    await expect(result).rejects.toThrow('QuickBooks token revocation request failed')
    await expect(result).rejects.not.toThrow('sensitive-refresh-token')
  })

  it('allows local cleanup when Intuit reports an already-invalid grant', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('sensitive-refresh-token quickbooks-client-secret', { status: 400 })
    )

    await expect(revokeQuickBooksToken('sensitive-refresh-token')).resolves.toBeUndefined()
  })

  it('sanitizes non-terminal non-success responses', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('sensitive-refresh-token quickbooks-client-secret', { status: 503 })
    )

    const result = revokeQuickBooksToken('sensitive-refresh-token')
    await expect(result).rejects.toThrow('QuickBooks token revocation failed with HTTP 503')
    await expect(result).rejects.not.toThrow('sensitive-refresh-token')
    await expect(result).rejects.not.toThrow('quickbooks-client-secret')
  })
})
