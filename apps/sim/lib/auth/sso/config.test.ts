/**
 * @vitest-environment node
 */
import { sso } from '@better-auth/sso'
import { betterAuth } from 'better-auth'
import { describe, expect, it } from 'vitest'
import {
  getAccountLinkingTrustedProviders,
  getSsoServerSecurityOptions,
  SSO_DISABLED_PATHS,
  SSO_DOMAIN_VERIFICATION_OPTIONS,
  SSO_SERVER_SECURITY_OPTIONS,
} from '@/lib/auth/sso/config'

describe('Better Auth SSO boundary', () => {
  it.each(SSO_DISABLED_PATHS)('blocks raw HTTP access to %s', async (path) => {
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-that-is-long-enough-for-better-auth',
      disabledPaths: [...SSO_DISABLED_PATHS],
      plugins: [sso(SSO_SERVER_SECURITY_OPTIONS)],
    })

    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'provider' }),
      })
    )
    expect(response.status).toBe(404)
  })

  it('keeps internal domain verification APIs available', () => {
    const auth = betterAuth({
      secret: 'test-secret-that-is-long-enough-for-better-auth',
      disabledPaths: [...SSO_DISABLED_PATHS],
      plugins: [sso(SSO_DOMAIN_VERIFICATION_OPTIONS)],
    })

    expect(auth.api.requestDomainVerification).toBeTypeOf('function')
    expect(auth.api.verifyDomain).toBeTypeOf('function')
    expect(auth.api.updateSSOProvider).toBeTypeOf('function')
    expect(auth.api.deleteSSOProvider).toBeTypeOf('function')
  })

  it('requires verified domains without trusting IdP email flags', () => {
    expect(SSO_SERVER_SECURITY_OPTIONS).toEqual({
      domainVerification: { enabled: true },
      trustEmailVerified: false,
      disableImplicitSignUp: false,
    })
    expect(getSsoServerSecurityOptions(false)).toMatchObject({
      domainVerification: { enabled: false },
      trustEmailVerified: true,
    })
  })

  it('trusts fixed first-party and operator-controlled provider IDs only', () => {
    expect(getAccountLinkingTrustedProviders(['operator-saml'])).toEqual([
      'google',
      'github',
      'email-password',
      'operator-saml',
    ])
  })
})
