import { describe, expect, it } from 'vitest'
import { resolveSsoCallbackProviderId } from '@/lib/auth/sso/callback-provider'

describe('SSO callback provider resolution', () => {
  it.each([
    '/sso/callback/:providerId',
    '/sso/saml2/callback/:providerId',
    '/sso/saml2/sp/acs/:providerId',
  ])('uses Better Auth route params for %s', (path) => {
    expect(resolveSsoCallbackProviderId({ path, routeProviderId: 'acme-sso' })).toBe('acme-sso')
  })

  it('uses OAuth state for Better Auth shared OIDC callbacks', () => {
    expect(
      resolveSsoCallbackProviderId({
        path: '/sso/callback',
        stateProviderId: 'acme-shared-sso',
      })
    ).toBe('acme-shared-sso')
  })

  it('supports a concrete callback path when the runtime exposes it', () => {
    expect(resolveSsoCallbackProviderId({ path: '/sso/callback/acme%2Dsso' })).toBe('acme-sso')
  })

  it.each([
    { path: '/subscription/upgrade' },
    { path: '/sso/callback/:providerId' },
    { path: '/sso/callback', stateProviderId: null },
    { path: '/sso/callback/acme%2Fsso' },
    { path: '/sso/callback/%E0%A4%A' },
  ])('rejects a callback context without a safe provider identity', (context) => {
    expect(resolveSsoCallbackProviderId(context)).toBeNull()
  })
})
