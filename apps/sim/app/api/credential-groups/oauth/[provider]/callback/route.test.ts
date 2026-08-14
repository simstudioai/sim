/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConsumeAttempt, mockGetContext, mockCompleteOAuth, mockRateLimit } = vi.hoisted(() => ({
  mockConsumeAttempt: vi.fn(),
  mockGetContext: vi.fn(),
  mockCompleteOAuth: vi.fn(),
  mockRateLimit: vi.fn(),
}))

vi.mock('@/lib/credential-groups/oauth-state', () => ({
  consumeCredentialGroupOAuthAttempt: mockConsumeAttempt,
}))

vi.mock('@/lib/credential-groups/enrollments', () => ({
  getCredentialGroupOAuthContext: mockGetContext,
}))

vi.mock('@/lib/credential-groups/oauth', () => ({
  completeCredentialGroupOAuth: mockCompleteOAuth,
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mockRateLimit,
}))

import { GET } from '@/app/api/credential-groups/oauth/[provider]/callback/route'

const attempt = {
  provider: 'gmail',
  invitationToken: 'invitation-token',
  optionId: 'option-1',
}
const context = { params: Promise.resolve({ provider: 'gmail' }) }

function request(query: string) {
  return new NextRequest(
    `http://localhost:3000/api/credential-groups/oauth/gmail/callback?${query}`
  )
}

describe('credential group OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue(null)
    mockConsumeAttempt.mockResolvedValue(attempt)
    mockGetContext.mockResolvedValue({ enrollmentId: 'enrollment-1' })
    mockCompleteOAuth.mockResolvedValue(undefined)
  })

  it('consumes provider-bound state and returns after a successful exchange', async () => {
    const response = await GET(request('state=state-1&code=code-1'), context)

    expect(mockConsumeAttempt).toHaveBeenCalledWith('state-1')
    expect(mockCompleteOAuth).toHaveBeenCalledWith(
      { enrollmentId: 'enrollment-1' },
      attempt,
      'code-1'
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?connected=option-1'
    )
  })

  it('returns without exchanging when the user denies consent', async () => {
    const response = await GET(request('state=state-1&error=access_denied'), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=denied'
    )
    expect(mockGetContext).not.toHaveBeenCalled()
    expect(mockCompleteOAuth).not.toHaveBeenCalled()
  })

  it('rejects replayed, expired, or cross-provider state', async () => {
    mockConsumeAttempt.mockResolvedValue(null)

    const replayedResponse = await GET(request('state=state-1&code=code-1'), context)
    expect(replayedResponse.status).toBe(400)

    mockConsumeAttempt.mockResolvedValue({ ...attempt, provider: 'slack' })
    const mismatchedResponse = await GET(request('state=state-2&code=code-2'), context)
    expect(mismatchedResponse.status).toBe(400)
    expect(mockCompleteOAuth).not.toHaveBeenCalled()
  })
})
