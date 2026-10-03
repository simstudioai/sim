import { describe, expect, it } from 'vitest'
import { resolveAuthRedirect, resolvePostSignupDestination } from '@/app/(auth)/auth-redirect'

describe('resolvePostSignupDestination', () => {
  it('keeps the verify hop owning the callback URL when verification is enforceable', () => {
    expect(
      resolvePostSignupDestination({
        emailVerificationEnabled: true,
        redirectUrl: '/invite/abc',
      })
    ).toEqual({ kind: 'verify' })
  })

  /**
   * Regression guard: signup used to push `/verify` unconditionally, stranding
   * self-hosted deployments with no mail provider on a screen no email can
   * satisfy.
   */
  it('never routes to verify when no mail provider is configured', () => {
    expect(
      resolvePostSignupDestination({ emailVerificationEnabled: false, redirectUrl: '' })
    ).toEqual({ kind: 'entry' })
  })
})

describe('resolveAuthRedirect', () => {
  const NONE = { redirect: null, callbackUrl: null, inviteFlow: null }

  it('treats an invitation destination as an invite flow without the flag', () => {
    expect(resolveAuthRedirect({ ...NONE, callbackUrl: '/invite/abc' }).isInviteFlow).toBe(true)
  })
})
