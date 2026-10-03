import { authMockFns } from '@sim/testing/mocks/auth.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { expect, it } from 'vitest'
import { GET } from '@/app/api/credential-groups/slack-managed-users/callback/route'

it('preserves sign-in recovery when the managed Slack callback loses its session', async () => {
  authMockFns.mockGetSession.mockResolvedValueOnce(null)
  const response = await GET(
    createMockRequest({
      url: 'http://localhost/api/credential-groups/slack-managed-users/callback?state=fixture-state&code=fixture-code',
    })
  )
  expect(response.status).toBe(303)
  const location = new URL(response.headers.get('location')!)
  expect(location.pathname).toBe('/credential-groups/slack-complete')
  expect(location.searchParams.get('state')).toBe('fixture-state')
  expect(location.searchParams.get('reason')).toBe('signin_required')
})
