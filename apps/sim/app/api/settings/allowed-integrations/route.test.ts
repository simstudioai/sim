import { createMockRequest } from '@sim/testing'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import {
  integrationsAvailabilityMock,
  integrationsAvailabilityMockFns,
} from '@sim/testing/mocks/integrations-availability.mock'
import { oauthUtilsMock, oauthUtilsMockFns } from '@sim/testing/mocks/oauth-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)
vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)

import { getAllowedIntegrationsContract } from '@/lib/api/contracts/common'
import { GET } from '@/app/api/settings/allowed-integrations/route'

const { mockGetAllOAuthServices } = oauthUtilsMockFns
const { mockGetIntegrationAvailability, mockGetOAuthServiceAvailability } =
  integrationsAvailabilityMockFns

describe('allowed integrations response', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetIntegrationAvailability.mockReturnValue([
      { type: 'github_v2', state: 'ready', oauthAvailable: false, missingFields: [] },
    ])
    mockGetAllOAuthServices.mockReturnValue([
      { providerId: 'github-repositories', authType: 'oauth' },
    ])
    mockGetOAuthServiceAvailability.mockReturnValue([
      { providerId: 'github-repositories', available: false },
    ])
  })

  it('authenticates before projecting deployment capabilities', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
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
    expect(mockGetIntegrationAvailability).not.toHaveBeenCalled()
    expect(mockGetOAuthServiceAvailability).not.toHaveBeenCalled()
    expect(mockGetAllOAuthServices).not.toHaveBeenCalled()
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
    expect(mockGetOAuthServiceAvailability).toHaveBeenCalledWith(
      mockGetAllOAuthServices.mock.results[0].value
    )
  })
})
