/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getIntegrationAvailability: vi.fn(),
  getOAuthServiceAvailability: vi.fn(),
  getAllOAuthServices: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/core/config/env-flags', () => ({ getAllowedIntegrationsFromEnv: () => null }))
vi.mock('@/lib/integrations/availability.server', () => ({
  getIntegrationAvailability: mocks.getIntegrationAvailability,
  getOAuthServiceAvailability: mocks.getOAuthServiceAvailability,
}))
vi.mock('@/lib/oauth/utils', () => ({ getAllOAuthServices: mocks.getAllOAuthServices }))

import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import { GET } from '@/app/api/settings/allowed-integrations/route'

describe('allowed integrations response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.getIntegrationAvailability.mockReturnValue([
      { type: 'github_v2', state: 'ready', oauthAvailable: false, missingFields: [] },
    ])
    mocks.getAllOAuthServices.mockReturnValue([
      { providerId: 'github-repositories', authType: 'oauth' },
    ])
    mocks.getOAuthServiceAvailability.mockReturnValue([
      { providerId: 'github-repositories', available: false },
    ])
  })

  it('authenticates before projecting deployment capabilities', async () => {
    mocks.getSession.mockResolvedValue(null)
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost/api/settings/allowed-integrations'
      ),
      {}
    )
    expect(response.status).toBe(401)
    expect(mocks.getIntegrationAvailability).not.toHaveBeenCalled()
    expect(mocks.getOAuthServiceAvailability).not.toHaveBeenCalled()
    expect(mocks.getAllOAuthServices).not.toHaveBeenCalled()
  })

  it('returns block and OAuth service readiness as distinct contract fields', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        undefined,
        'http://localhost/api/settings/allowed-integrations'
      ),
      {}
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(getAllowedIntegrationsContract.response.schema.safeParse(body).success).toBe(true)
    expect(body).toEqual({
      allowedIntegrations: null,
      integrationAvailability: [{ type: 'github_v2', state: 'ready', oauthAvailable: false }],
      oauthServiceAvailability: [{ providerId: 'github-repositories', available: false }],
    })
    expect(mocks.getOAuthServiceAvailability).toHaveBeenCalledWith(
      mocks.getAllOAuthServices.mock.results[0].value
    )
  })
})
