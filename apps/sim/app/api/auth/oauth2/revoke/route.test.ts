/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  oauthEnabled: vi.fn(),
  rateLimit: vi.fn(async () => null),
  revoke: vi.fn(),
}))

vi.mock('@/lib/auth/oauth-provider-feature', () => ({
  isOAuthProviderEnabled: mocks.oauthEnabled,
}))
vi.mock('@/lib/core/rate-limiter', () => ({ enforceIpRateLimit: mocks.rateLimit }))
vi.mock('@/lib/auth/oauth-token-family', () => ({ revokeOAuthToken: mocks.revoke }))

import { POST } from '@/app/api/auth/oauth2/revoke/route'

function revokeRequest(body: string) {
  return new NextRequest('http://localhost/api/auth/oauth2/revoke', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

describe('OAuth revocation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.oauthEnabled.mockResolvedValue(true)
    mocks.revoke.mockResolvedValue({ success: true, value: undefined })
  })

  it('returns the empty RFC 7009 success response for known or unknown tokens', async () => {
    const response = await POST(
      revokeRequest('client_id=sim-cli&token=sim_ort_current&token_type_hint=not-a-real-hint')
    )
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('')
    expect(mocks.revoke).toHaveBeenCalledWith({
      credentials: { clientId: 'sim-cli', method: 'none' },
      token: 'sim_ort_current',
    })
  })

  it('applies the runtime flag before revocation admission or protected work', async () => {
    const request = () => revokeRequest('client_id=sim-cli&token=sim_ort_current')
    expect((await POST(request())).status).toBe(200)
    mocks.revoke.mockClear()
    mocks.rateLimit.mockClear()

    mocks.oauthEnabled.mockResolvedValue(false)
    const disabled = await POST(request())
    expect(disabled.status).toBe(404)
    expect(disabled.headers.get('cache-control')).toBe('no-store')
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()

    mocks.oauthEnabled.mockResolvedValue(true)
    expect((await POST(request())).status).toBe(200)
    expect(mocks.revoke).toHaveBeenCalledOnce()
  })

  it('returns a Basic challenge for Basic client-authentication failure', async () => {
    mocks.revoke.mockResolvedValue({
      success: false,
      error: 'invalid_client',
      description: 'Client authentication failed.',
    })
    const basic = Buffer.from('client:wrong').toString('base64')
    const request = revokeRequest('token=sim_ort_current')
    request.headers.set('authorization', `Basic ${basic}`)
    const response = await POST(request)
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Basic')
  })

  it('normalizes an unexpected revocation failure', async () => {
    mocks.revoke.mockRejectedValueOnce(new Error('database details'))

    const response = await POST(revokeRequest('client_id=sim-cli&token=sim_ort_current'))

    expect(response.status).toBe(500)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    await expect(response.json()).resolves.toEqual({
      error: 'server_error',
      error_description: 'Revocation endpoint failed.',
    })
  })
})
