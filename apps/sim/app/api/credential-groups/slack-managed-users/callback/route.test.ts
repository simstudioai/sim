import { authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/credential-groups/slack-managed-users/callback/route'

describe('GET /api/credential-groups/slack-managed-users/callback', () => {
  it('sends a signed-out browser to the sign-in recovery screen', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const response = await GET(
      new NextRequest(
        'http://localhost/api/credential-groups/slack-managed-users/callback?state=s1&code=c1'
      ),
      {}
    )
    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/credential-groups/slack-complete')
    expect(location.searchParams.get('reason')).toBe('signin_required')
  })
})
