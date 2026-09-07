/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAuthCrossLink,
  resolveAuthRedirect,
  resolvePostSignupDestination,
} from '@/app/(auth)/auth-redirect'

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
    ).toEqual({ kind: 'entry' })
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

  it('marks a new user so the invite page leads with account creation', () => {
    expect(
      buildAuthCrossLink('/signup', {
        callbackUrl: '/invite/abc',
        isInviteFlow: true,
        isNewUser: true,
      })
    ).toBe('/signup?invite_flow=true&callbackUrl=%2Finvite%2Fabc&new=true')
  })

  it('omits the new-user marker by default', () => {
    expect(buildAuthCrossLink('/signup', { callbackUrl: null, isInviteFlow: true })).not.toContain(
      'new=true'
    )
  })
})

describe('resolveAuthRedirect', () => {
  const NONE = { redirect: null, callbackUrl: null, inviteFlow: null }

  it('prefers redirect over callbackUrl', () => {
    expect(resolveAuthRedirect({ ...NONE, redirect: '/a', callbackUrl: '/b' }).rawCallbackUrl).toBe(
      '/a'
    )
  })

  it('falls through an empty redirect to callbackUrl', () => {
    expect(
      resolveAuthRedirect({ ...NONE, redirect: '', callbackUrl: '/invite/abc' }).rawCallbackUrl
    ).toBe('/invite/abc')
  })

  it('reports no destination when nothing was carried', () => {
    expect(resolveAuthRedirect(NONE)).toEqual({ rawCallbackUrl: '', isInviteFlow: false })
  })

  it('treats an invitation destination as an invite flow without the flag', () => {
    expect(resolveAuthRedirect({ ...NONE, callbackUrl: '/invite/abc' }).isInviteFlow).toBe(true)
  })

  it('honors the explicit flag when the destination is unrelated', () => {
    expect(
      resolveAuthRedirect({ ...NONE, callbackUrl: '/workspace', inviteFlow: 'true' }).isInviteFlow
    ).toBe(true)
  })
})
