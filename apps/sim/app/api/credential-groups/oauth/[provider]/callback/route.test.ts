/**
 * @vitest-environment node
 */
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  completeOAuth: vi.fn(),
  consumeAttempt: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  authenticateCredentialGroupEnrollment: mocks.authenticate,
}))

vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupOAuth: { execute: mocks.completeOAuth },
}))

vi.mock('@/lib/credential-groups/oauth-state', () => ({
  consumeCredentialGroupOAuthAttempt: mocks.consumeAttempt,
}))

vi.mock('@/lib/credential-groups/rate-limit', () => ({
  enforcePublicCredentialGroupIpRateLimit: mocks.rateLimit,
}))

import { CredentialGroupInvitationUnavailableError } from '@/lib/credential-groups/provider-adapter'
import { GET } from '@/app/api/credential-groups/oauth/[provider]/callback/route'

const principal = {
  kind: 'credential_group_enrollment',
  workspaceId: 'workspace-1',
  credentialGroupId: 'group-1',
  enrollmentId: 'enrollment-1',
  email: 'alex@example.com',
  invitationTokenHash: 'hash-1',
} as const
const attempt = {
  provider: 'slack',
  invitationToken: 'invitation-token',
  optionId: 'option-1',
}
const context = { params: Promise.resolve({ provider: 'slack' }) }

function request(query: string) {
  return new NextRequest(
    `http://localhost:3000/api/credential-groups/oauth/slack/callback?${query}`
  )
}

describe('credential group OAuth callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rateLimit.mockResolvedValue(null)
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.authenticate.mockResolvedValue(principal)
    mocks.completeOAuth.mockResolvedValue({ connectedOptionId: 'option-1' })
  })

  it('consumes provider-bound state and enters the application operation', async () => {
    const callbackRequest = request('state=state-1&code=code-1')
    const response = await GET(callbackRequest, context)

    expect(mocks.consumeAttempt).toHaveBeenCalledWith('state-1')
    expect(mocks.completeOAuth).toHaveBeenCalledWith({
      principal,
      input: { attempt, code: 'code-1' },
      request: callbackRequest,
    })
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?connected=option-1'
    )
  })

  it('rejects standard providers on the custom callback route', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/credential-groups/oauth/gmail/callback?state=state-1&code=code-1'
      ),
      { params: Promise.resolve({ provider: 'gmail' }) }
    )

    expect(response.status).toBe(400)
    expect(mocks.consumeAttempt).not.toHaveBeenCalled()
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })

  it('returns without exchanging when the user denies consent', async () => {
    const response = await GET(request('state=state-1&error=access_denied'), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=denied'
    )
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })

  it('rejects replayed, expired, or cross-provider state', async () => {
    mocks.consumeAttempt.mockResolvedValue(null)

    const replayedResponse = await GET(request('state=state-1&code=code-1'), context)
    expect(replayedResponse.status).toBe(400)

    mocks.consumeAttempt.mockResolvedValue({ ...attempt, provider: 'gmail' })
    const mismatchedResponse = await GET(request('state=state-2&code=code-2'), context)
    expect(mismatchedResponse.status).toBe(400)
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })

  it('returns an unavailable enrollment redirect when the invitation was revoked in flight', async () => {
    mocks.authenticate.mockResolvedValue(null)

    const response = await GET(request('state=state-1&code=code-1'), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=unavailable'
    )
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })

  it('returns an unavailable enrollment redirect when the invitation is revoked during exchange', async () => {
    mocks.completeOAuth.mockRejectedValueOnce(new CredentialGroupInvitationUnavailableError())

    const response = await GET(request('state=state-1&code=code-1'), context)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=unavailable'
    )
  })

  it('returns a valid rate-limited callback to the enrollment page without exchanging', async () => {
    mocks.rateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )

    const response = await GET(request('state=state-1&code=code-1'), context)

    expect(mocks.consumeAttempt).toHaveBeenCalledWith('state-1')
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      '/credential-groups/enroll/invitation-token?oauth=rate_limited'
    )
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.completeOAuth).not.toHaveBeenCalled()
  })
})
