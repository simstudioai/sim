import { createMockRequest } from '@sim/testing'
import { createRouteContext } from '@sim/testing/helpers/http'
import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { oauthUtilsMock, oauthUtilsMockFns } from '@sim/testing/mocks/oauth-utils.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireConfiguredOAuthClient: vi.fn(),
}))

vi.mock('@/lib/core/config/env-capabilities.server', () => ({
  requireConfiguredOAuthClient: mocks.requireConfiguredOAuthClient,
}))

vi.mock('@/lib/oauth/utils', () => oauthUtilsMock)

import { GET } from '@/app/api/auth/instagram/authorize/route'

urlsMockFns.mockGetBaseUrl.mockReturnValue('https://sim.test')
oauthUtilsMockFns.mockGetCanonicalScopesForProvider.mockReturnValue(['instagram_business_basic'])

describe('Instagram authorize route', () => {
  beforeEach(() => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mocks.requireConfiguredOAuthClient.mockReturnValue({
      values: { INSTAGRAM_CLIENT_ID: 'instagram-client' },
    })
  })

  it('preserves an exact credential draft when workspaceId is also supplied', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      'https://sim.test/api/auth/instagram/authorize?workspaceId=workspace-1&draftId=draft-exact'
    )

    const response = await GET(request, createRouteContext({}))

    expect(response.status).toBe(307)
    expect(response.headers.get('set-cookie')).toContain(
      'instagram_credential_draft_id=draft-exact'
    )
  })

  it('sends a workspace connect link to the confirmation page without starting it', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      { 'sec-fetch-site': 'same-origin' },
      'https://sim.test/api/auth/instagram/authorize?workspaceId=workspace-1&returnUrl=https%3A%2F%2Fsim.test%2Fhome'
    )

    const response = await GET(request, createRouteContext({}))

    expect(response.headers.get('location')).toBe(
      'https://sim.test/oauth/connect?providerId=instagram&workspaceId=workspace-1&callbackURL=https%3A%2F%2Fsim.test%2Fhome'
    )
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
