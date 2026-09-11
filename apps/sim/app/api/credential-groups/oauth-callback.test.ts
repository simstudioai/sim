/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import { OAuthIdentityVerificationError } from '@/lib/oauth/identity-error'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  completeOAuth: vi.fn(),
  consumeAttempt: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ error: mocks.logError }),
}))
vi.mock('@/lib/credential-groups/application/enrollment-auth', () => ({
  credentialGroupOAuthAttemptPrincipal: mocks.authenticate,
}))
vi.mock('@/lib/credential-groups/application/public-enrollment', () => ({
  completePublicCredentialGroupOAuth: { execute: mocks.completeOAuth },
}))
vi.mock('@/lib/credential-groups/oauth-state', () => ({
  consumeCredentialGroupOAuthAttempt: mocks.consumeAttempt,
}))

import { handleCredentialGroupOAuthCallback } from '@/app/api/credential-groups/oauth-callback'

const completionId = '550e8400-e29b-41d4-a716-446655440000'
const attempt = {
  provider: 'github-repositories',
  invitationToken: 'invitation-token',
  optionId: 'option-1',
  returnTo: 'search',
} as const

function completeCallback() {
  return handleCredentialGroupOAuthCallback({
    request: new NextRequest(
      'https://sim.test/api/auth/oauth2/callback/github-repositories?state=cg_state&code=code-1'
    ),
    provider: 'github-repositories',
    query: { state: 'cg_state', code: 'code-1' },
    limited: null,
  })
}

describe('GitHub managed OAuth failure presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticate.mockResolvedValue({ kind: 'credential_group_enrollment' })
  })

  describe.each([false, true])('completion redirect: %s', (completionRedirect) => {
    it.each([
      {
        failure: new OAuthIdentityVerificationError('email_mismatch', 'emails'),
        status: 'github_email_mismatch',
      },
      {
        failure: new OAuthIdentityVerificationError('email_access_denied', 'emails', 403),
        status: 'github_email_access_denied',
      },
      {
        failure: new OAuthIdentityVerificationError('provider_unavailable', 'profile', 503),
        status: 'provider_unavailable',
      },
      {
        failure: new OAuthIdentityVerificationError('rate_limited', 'emails', 403),
        status: 'rate_limited',
      },
      {
        failure: new OAuthIdentityVerificationError('invalid_response', 'emails'),
        status: 'provider_unavailable',
      },
      {
        failure: new OAuthIdentityVerificationError('provider_rejected', 'profile', 401),
        status: 'failed',
      },
    ])('presents $status and logs only safe diagnostics', async ({ failure, status }) => {
      mocks.consumeAttempt.mockResolvedValue({ ...attempt, completionRedirect, completionId })
      mocks.completeOAuth.mockRejectedValueOnce(
        new CredentialGroupOAuthError('Private details: member@example.com ghu_token', 502, failure)
      )
      const response = await completeCallback()
      const location = new URL(response.headers.get('location')!, 'https://sim.test')
      expect(location.searchParams.get('oauth')).toBe(status)
      if (completionRedirect) {
        expect(location.pathname).toBe('/credential-groups/complete')
        expect(location.searchParams.get('completionId')).toBe(completionId)
      } else {
        expect(location.pathname).toBe('/credential-groups/enroll/invitation-token')
        expect(location.searchParams.get('optionId')).toBe(attempt.optionId)
        expect(location.searchParams.get('returnTo')).toBe('search')
      }
      expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
        provider: 'github-repositories',
        failure: status,
        errorClass: 'credential_group_oauth',
        statusCode: 502,
        identityReason: failure.reason,
        identityStage: failure.stage,
        providerStatus: failure.httpStatus,
      })
      expect(response.headers.get('location')).not.toContain('member@example.com')
      expect(response.headers.get('location')).not.toContain('ghu_token')
    })
  })

  it('does not infer an identity failure from an untyped provider exception', async () => {
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(new Error('member@example.com ghu_token'))
    const response = await completeCallback()
    expect(response.headers.get('location')).toContain('oauth=failed')
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'github-repositories',
      failure: 'failed',
      errorClass: 'unexpected',
    })
  })

  it('retains an application error classification without its private details', async () => {
    mocks.consumeAttempt.mockResolvedValue(attempt)
    mocks.completeOAuth.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Private details: member@example.com')
    )
    await completeCallback()
    expect(mocks.logError).toHaveBeenCalledExactlyOnceWith('Managed OAuth authorization failed', {
      provider: 'github-repositories',
      failure: 'failed',
      errorClass: 'application',
      applicationCode: 'forbidden',
      statusCode: 403,
    })
  })
})
