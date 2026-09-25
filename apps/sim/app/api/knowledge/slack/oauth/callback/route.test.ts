import { authMockFns, dbChainMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const m = vi.hoisted(() => ({
  authenticate: vi.fn(),
  complete: vi.fn(),
  rate: vi.fn(),
}))
vi.mock('@/lib/slack-search/public-install-auth', () => ({
  authenticateSlackPublicInstallation: m.authenticate,
}))
vi.mock('@/lib/knowledge/application/slack-search/setup', () => ({
  completeSlackSearchSetup: { execute: m.complete },
}))
vi.mock('@/lib/core/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/rate-limiter')>()),
  enforceIpRateLimit: m.rate,
  enforceUserRateLimit: m.rate,
}))
vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://www.sim.ai',
  SITE_URL: 'https://www.sim.ai',
}))

import { GET, HEAD } from '@/app/api/knowledge/slack/oauth/callback/route'

const request = (query: string) =>
  new NextRequest(`https://www.sim.ai/api/knowledge/slack/oauth/callback?${query}`)
beforeEach(() => {
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'admin' },
    session: { id: 'session' },
  })
  m.rate.mockResolvedValue(null)
  m.authenticate.mockResolvedValue({ teamId: 'T1' })
  m.complete.mockResolvedValue({ organizationId: 'org1' })
})
describe('Slack OAuth callback', () => {
  it.each(['code=code', 'state=&code=code'])(
    'accepts Slack-initiated install without Sim login: %s',
    async (query) => {
      authMockFns.mockGetSession.mockResolvedValue(null)
      const response = await GET(request(query))
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toBe('https://www.sim.ai/slack-search/install/T1')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(m.complete).not.toHaveBeenCalled()
    }
  )
  it('does not attach a public grant to an existing browser session', async () => {
    await GET(request('code=code&organizationId=attacker'))
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('keeps org-initiated installs on the existing session/state path', async () => {
    const response = await GET(request('state=state&code=code'))
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://www.sim.ai/o/org1/settings/search-slack?slackSetup=complete'
    )
    expect(m.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'admin', sessionId: 'session' },
        input: { state: 'state', code: 'code', error: undefined },
      })
    )
    expect(m.authenticate).not.toHaveBeenCalled()
  })
  it('never falls back to public install on an invalid nonempty state', async () => {
    m.complete.mockRejectedValueOnce(new OrchestrationError('validation', 'Expired state'))
    expect((await GET(request('state=expired&code=code'))).status).toBe(400)
    expect(m.authenticate).not.toHaveBeenCalled()
  })
  it('still requires a Sim session for an org-bound state', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await GET(request('state=state&code=code'))).status).toBe(401)
    expect(m.authenticate).not.toHaveBeenCalled()
    expect(m.complete).not.toHaveBeenCalled()
  })
  it.each(['error=access_denied', '', 'state=&state=other&code=code', 'code=a&code=b'])(
    'rejects ambiguous or denied callbacks: %s',
    async (query) => {
      expect((await GET(request(query))).status).toBe(400)
      expect(m.authenticate).not.toHaveBeenCalled()
      expect(m.complete).not.toHaveBeenCalled()
    }
  )
  it('does not consume codes on HEAD requests or after rate limiting', async () => {
    expect((await HEAD(request('code=code'))).status).toBe(405)
    m.rate.mockResolvedValue(new Response(null, { status: 429 }))
    expect((await GET(request('code=code'))).status).toBe(429)
    expect(m.authenticate).not.toHaveBeenCalled()
  })
})
