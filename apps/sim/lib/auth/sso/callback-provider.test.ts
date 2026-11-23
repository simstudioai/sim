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

  it.each([
    { path: '/sso/callback/:providerId', routeProviderId: 'acme%2Fidp', expected: 'acme%2Fidp' },
    { path: '/sso/callback/:providerId', routeProviderId: 'acme%2Dsso', expected: 'acme%2Dsso' },
    { path: '/sso/callback/acme%2Fidp', expected: 'acme%2Fidp' },
    { path: '/sso/callback/acme%2Dsso', expected: 'acme%2Dsso' },
  ])('returns the undecoded id the plugin looked up for $path', ({ expected, ...context }) => {
    expect(resolveSsoCallbackProviderId(context)).toBe(expected)
  })

  it.each([
    { path: '/subscription/upgrade' },
    { path: '/sso/callback/:providerId' },
    { path: '/sso/callback/:providerId', routeProviderId: '' },
    { path: '/sso/callback', stateProviderId: null },
  ])('returns no provider for a context without a provider identity', (context) => {
    expect(resolveSsoCallbackProviderId(context)).toBeUndefined()
  })
})
