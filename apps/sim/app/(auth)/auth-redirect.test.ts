/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildAuthCrossLink, resolvePostSignupDestination } from '@/app/(auth)/auth-redirect'

describe('resolvePostSignupDestination', () => {
  it('routes to the verify hop when verification is enforceable', () => {
    expect(
      resolvePostSignupDestination({ emailVerificationEnabled: true, redirectUrl: '' })
    ).toEqual({ kind: 'verify' })
  })

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
    ).toEqual({ kind: 'workspace' })
  })

  it('preserves the callback URL when verification is not enforceable', () => {
    expect(
      resolvePostSignupDestination({
        emailVerificationEnabled: false,
        redirectUrl: '/cli/auth?callback=http%3A%2F%2F127.0.0.1%3A9000&state=xyz',
      })
    ).toEqual({
      kind: 'redirect',
      url: '/cli/auth?callback=http%3A%2F%2F127.0.0.1%3A9000&state=xyz',
    })
  })
})

describe('buildAuthCrossLink', () => {
  it('carries the invite flow and callback URL across the login/signup hop', () => {
    expect(buildAuthCrossLink('/login', { callbackUrl: '/invite/abc', isInviteFlow: true })).toBe(
      '/login?invite_flow=true&callbackUrl=%2Finvite%2Fabc'
    )
  })

  it('drops the query entirely when nothing needs carrying', () => {
    expect(buildAuthCrossLink('/signup', { callbackUrl: null, isInviteFlow: false })).toBe(
      '/signup'
    )
  })
})
