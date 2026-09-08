/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => null),
  revoke: vi.fn(),
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

afterAll(resetEnvFlagsMock)

describe('OAuth revocation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAuthDisabled: false })
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

  it('requires authentication before revocation admission or protected work', async () => {
    setEnvFlags({ isAuthDisabled: true })
    const response = await POST(revokeRequest('client_id=sim-cli&token=sim_ort_current'))
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.revoke).not.toHaveBeenCalled()
    expect(mocks.rateLimit).not.toHaveBeenCalled()
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
