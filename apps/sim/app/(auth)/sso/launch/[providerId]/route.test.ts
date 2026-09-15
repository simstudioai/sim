/**
 * @vitest-environment node
 */
import { createMockRequest, setEnvFlags } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockSignInSSO, mockIsAllowed, mockEnforceIpRateLimit } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignInSSO: vi.fn(),
  mockIsAllowed: vi.fn(),
  mockEnforceIpRateLimit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
  auth: { api: { signInSSO: mockSignInSSO } },
}))
vi.mock('@/lib/auth/sso/idp-initiated-login', () => ({ isIdpInitiatedLoginAllowed: mockIsAllowed }))
vi.mock('@/lib/core/rate-limiter', () => ({ enforceIpRateLimit: mockEnforceIpRateLimit }))

import { GET } from '@/app/(auth)/sso/launch/[providerId]/route'

const context = { params: Promise.resolve({ providerId: 'acme-okta' }) }
const ISSUER = 'https://acme.okta.test'
const SIGN_IN_LINK = 'https://test.sim.ai/sso?provider=acme-okta'

function open(search = `?iss=${encodeURIComponent(ISSUER)}`) {
  return GET(
    createMockRequest('GET', undefined, {}, `https://test.sim.ai/sso/launch/acme-okta${search}`),
    context
  )
}

/** Better Auth answers with the authorization URL and the signed `state` cookie for it. */
function authorizationResponse() {
  return new Response(JSON.stringify({ url: 'https://acme.okta.test/oauth2/v1/authorize?x=1' }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': 'sso_state=abc; Path=/' },
  })
}

describe('GET /sso/launch/[providerId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isSsoEnabled: true })
    mockGetSession.mockResolvedValue(null)
    mockIsAllowed.mockResolvedValue(true)
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockSignInSSO.mockResolvedValue(authorizationResponse())
  })

  it("redirects to the identity provider and carries Better Auth's state cookie", async () => {
    const response = await open()

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://acme.okta.test/oauth2/v1/authorize?x=1')
    expect(response.headers.get('set-cookie')).toContain('sso_state=abc')
    expect(mockIsAllowed).toHaveBeenCalledWith('acme-okta', ISSUER)
    const [{ body }] = mockSignInSSO.mock.calls[0]
    expect(body.providerId).toBe('acme-okta')
    expect(body).not.toHaveProperty('email')
    /** The plugin appends `?error=…`, which must not corrupt the provider on the way back. */
    const retry = new URL(`${body.errorCallbackURL}?error=invalid_provider`)
    expect(retry.pathname).toBe('/sso')
    expect(retry.searchParams.get('provider')).toBe('acme-okta')
  })

  it('sends someone already signed in to the app without signing in again', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })

    const response = await open()

    expect(response.headers.get('location')).toBe('https://test.sim.ai/home')
    expect(mockIsAllowed).not.toHaveBeenCalled()
    expect(mockSignInSSO).not.toHaveBeenCalled()
  })

  it('keeps sending a signed-in visitor to the app when the address is rate limited', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockEnforceIpRateLimit.mockResolvedValue(new Response(null, { status: 429 }))

    const response = await open()

    expect(response.headers.get('location')).toBe('https://test.sim.ai/home')
    expect(mockEnforceIpRateLimit).not.toHaveBeenCalled()
  })

  it.each([
    ['no issuer', '', () => undefined],
    [
      'an issuer the provider does not use',
      `?iss=${encodeURIComponent('https://other.test')}`,
      () => mockIsAllowed.mockResolvedValue(false),
    ],
  ])("sends a visitor with %s to the provider's sign-in link", async (_label, search, arrange) => {
    arrange()

    const response = await open(search)

    expect(response.headers.get('location')).toBe(SIGN_IN_LINK)
    expect(mockSignInSSO).not.toHaveBeenCalled()
  })

  it("falls back to the provider's sign-in link when sign-in cannot start", async () => {
    mockSignInSSO.mockResolvedValue(new Response('{}', { status: 400 }))

    const response = await open()

    expect(response.headers.get('location')).toBe(SIGN_IN_LINK)
  })

  it('sends a rate-limited visitor to the sign-in link before any lookup', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(new Response(null, { status: 429 }))

    const response = await open()

    expect(response.headers.get('location')).toBe(SIGN_IN_LINK)
    expect(mockIsAllowed).not.toHaveBeenCalled()
    expect(mockSignInSSO).not.toHaveBeenCalled()
  })

  it('leaves SSO off when the deployment has not enabled it', async () => {
    setEnvFlags({ isSsoEnabled: false })

    const response = await open()

    expect(response.headers.get('location')).toBe('https://test.sim.ai/login')
    expect(mockEnforceIpRateLimit).not.toHaveBeenCalled()
  })
})
