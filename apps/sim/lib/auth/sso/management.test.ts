/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = vi.hoisted(() => ({
  mockSecureFetchWithPinnedIP: vi.fn(),
  mockValidateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mockSecureFetchWithPinnedIP,
  validateUrlWithDNS: mockValidateUrlWithDNS,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://app.example.com',
}))

vi.mock('@/lib/billing', () => ({
  isOrganizationOnEnterprisePlan: vi.fn(),
}))

import {
  buildSSOProviderConfiguration,
  domainsOverlap,
  requireNormalizedSSODomain,
  SSO_PROVIDER_ID_MAX_LENGTH,
  SSOManagementError,
  ssoManagementErrorResponse,
  validateSSOProviderId,
} from '@/lib/auth/sso/management'

const SAML_BODY = {
  providerType: 'saml' as const,
  providerId: 'acme-saml',
  orgId: 'org-1',
  issuer: 'https://idp.example.com',
  domain: 'acme.com',
  mapping: {
    id: 'name-id',
    email: 'email',
    name: 'name',
    image: 'picture',
  },
  entryPoint: 'https://idp.example.com/sso',
  cert: '-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----',
  wantAssertionsSigned: true,
}

const OIDC_BODY = {
  providerType: 'oidc' as const,
  providerId: 'acme-oidc',
  orgId: 'org-1',
  issuer: 'https://idp.example.com',
  domain: 'acme.com',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  pkce: true,
  mapping: {
    id: 'sub',
    email: 'email',
    name: 'name',
    image: 'picture',
  },
  authorizationEndpoint: 'https://idp.example.com/authorize',
  tokenEndpoint: 'https://idp.example.com/token',
  userInfoEndpoint: 'https://idp.example.com/userinfo',
  jwksEndpoint: 'https://idp.example.com/jwks',
  skipUserInfoEndpoint: false,
}

const LEGACY_GENERATED_IDP_METADATA = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com">
  <IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>PUBLIC</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.com/sso"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`

describe('SSO management helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '192.0.2.1' })
    mockSecureFetchWithPinnedIP.mockRejectedValue(new Error('Discovery unavailable'))
  })

  it('detects exact and bidirectional suffix overlap', () => {
    expect(domainsOverlap('acme.com', 'acme.com')).toBe(true)
    expect(domainsOverlap('login.acme.com', 'acme.com')).toBe(true)
    expect(domainsOverlap('acme.com', 'login.acme.com')).toBe(true)
    expect(domainsOverlap('LOGIN.CORP', 'login.corp')).toBe(true)
    expect(domainsOverlap('AUTH.LOGIN.CORP', 'login.corp')).toBe(true)
    expect(domainsOverlap('login.corp', 'AUTH.LOGIN.CORP')).toBe(true)
    expect(domainsOverlap('notacme.com', 'acme.com')).toBe(false)
  })

  it('enforces the Better Auth verification identifier DNS-label limit', () => {
    expect(() => validateSSOProviderId('a'.repeat(SSO_PROVIDER_ID_MAX_LENGTH))).not.toThrow()
    expect(() => validateSSOProviderId('a'.repeat(SSO_PROVIDER_ID_MAX_LENGTH + 1))).toThrow(
      SSOManagementError
    )
  })

  it.each(['google', 'github', 'email-password'])(
    'rejects the globally trusted built-in provider ID %s',
    (providerId) => {
      expect(() => validateSSOProviderId(providerId)).toThrow(
        expect.objectContaining({ code: 'SSO_PROVIDER_ID_RESERVED' })
      )
    }
  )

  it('preserves an unchanged legacy internal domain while requiring registrable replacements', () => {
    expect(requireNormalizedSSODomain('LOGIN.CORP', 'login.corp')).toBe('login.corp')
    expect(() => requireNormalizedSSODomain('other.corp', 'login.corp')).toThrow(SSOManagementError)
  })

  it('builds explicit OIDC configuration when optional discovery is unavailable', async () => {
    const result = await buildSSOProviderConfiguration(OIDC_BODY, {
      providerId: OIDC_BODY.providerId,
      organizationId: OIDC_BODY.orgId,
    })

    if (!('oidcConfig' in result)) throw new Error('Expected OIDC configuration')
    expect(result.oidcConfig).toMatchObject({
      authorizationEndpoint: OIDC_BODY.authorizationEndpoint,
      tokenEndpoint: OIDC_BODY.tokenEndpoint,
      userInfoEndpoint: OIDC_BODY.userInfoEndpoint,
      jwksEndpoint: OIDC_BODY.jwksEndpoint,
      tokenEndpointAuthentication: 'client_secret_post',
      skipDiscovery: true,
      scopes: ['openid', 'profile', 'email'],
    })
  })

  it('rejects a required discovered endpoint that fails SSRF validation', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'http://169.254.169.254/authorize',
        token_endpoint: OIDC_BODY.tokenEndpoint,
        jwks_uri: OIDC_BODY.jwksEndpoint,
      }),
    })
    mockValidateUrlWithDNS.mockImplementation(async (url: string) =>
      url.includes('169.254.169.254')
        ? { isValid: false, error: 'resolves to a private IP address' }
        : { isValid: true, resolvedIP: '192.0.2.1' }
    )

    await expect(
      buildSSOProviderConfiguration(
        { ...OIDC_BODY, authorizationEndpoint: undefined },
        { providerId: OIDC_BODY.providerId, organizationId: OIDC_BODY.orgId }
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('does not validate or retain a userinfo endpoint when ID-token claims are requested', async () => {
    mockValidateUrlWithDNS.mockImplementation(async (_url: string, label: string) => {
      if (label.toLowerCase().includes('userinfo')) {
        return { isValid: false, error: 'resolves to a private IP address' }
      }
      return { isValid: true, resolvedIP: '192.0.2.1' }
    })

    const result = await buildSSOProviderConfiguration(
      { ...OIDC_BODY, skipUserInfoEndpoint: true },
      { providerId: OIDC_BODY.providerId, organizationId: OIDC_BODY.orgId }
    )
    if (!('oidcConfig' in result)) throw new Error('Expected OIDC configuration')
    expect(result.oidcConfig.userInfoEndpoint).toBeUndefined()
  })

  it('uses discovery auth metadata without validating unused discovered endpoints', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'http://169.254.169.254/unused',
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      }),
    })
    mockValidateUrlWithDNS.mockImplementation(async (url: string) => {
      if (url.includes('169.254.169.254')) {
        return { isValid: false, error: 'resolves to a private IP address' }
      }
      return { isValid: true, resolvedIP: '192.0.2.1' }
    })

    const result = await buildSSOProviderConfiguration(OIDC_BODY, {
      providerId: OIDC_BODY.providerId,
      organizationId: OIDC_BODY.orgId,
    })
    if (!('oidcConfig' in result)) throw new Error('Expected OIDC configuration')
    expect(result.oidcConfig.authorizationEndpoint).toBe(OIDC_BODY.authorizationEndpoint)
    expect(result.oidcConfig.tokenEndpointAuthentication).toBe('client_secret_post')
  })

  it('builds complete SAML metadata without OIDC DNS or fetch work', async () => {
    const result = await buildSSOProviderConfiguration(SAML_BODY, {
      providerId: SAML_BODY.providerId,
      organizationId: SAML_BODY.orgId,
    })

    expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
    expect(mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      providerId: 'acme-saml',
      domain: 'acme.com',
      organizationId: 'org-1',
      samlConfig: {
        callbackUrl: 'https://app.example.com/api/auth/sso/saml2/callback/acme-saml',
        idpMetadata: { metadata: expect.stringContaining('https://idp.example.com/sso') },
        spMetadata: {
          metadata: expect.stringContaining(
            'https://app.example.com/api/auth/sso/saml2/callback/acme-saml'
          ),
        },
      },
    })
    if (!('samlConfig' in result)) throw new Error('Expected SAML configuration')
    expect(result.samlConfig.spMetadata.metadata).toContain('entityID="https://app.example.com"')
    expect(result.samlConfig.spMetadata.metadata).not.toContain('/sp/metadata?')
  })

  it('rebuilds generated IdP metadata when the certificate rotates', async () => {
    const original = await buildSSOProviderConfiguration(SAML_BODY, {
      providerId: SAML_BODY.providerId,
      organizationId: SAML_BODY.orgId,
    })
    if (!('samlConfig' in original)) throw new Error('Expected SAML configuration')

    const rotated = await buildSSOProviderConfiguration(
      {
        ...SAML_BODY,
        cert: '-----BEGIN CERTIFICATE-----\nROTATED\n-----END CERTIFICATE-----',
        idpMetadata: LEGACY_GENERATED_IDP_METADATA,
      },
      {
        providerId: SAML_BODY.providerId,
        organizationId: SAML_BODY.orgId,
        existingConfig: JSON.stringify({
          ...original.samlConfig,
          idpMetadata: { metadata: LEGACY_GENERATED_IDP_METADATA },
        }),
        existingIssuer: SAML_BODY.issuer,
      }
    )
    if (!('samlConfig' in rotated)) throw new Error('Expected SAML configuration')

    expect(rotated.samlConfig.idpMetadata.metadata).toContain('ROTATED')
    expect(rotated.samlConfig.idpMetadata.metadata).not.toContain('PUBLIC')
  })

  it('preserves explicitly supplied IdP metadata during certificate rotation', async () => {
    const customMetadata = '<EntityDescriptor entityID="custom" />'
    const original = await buildSSOProviderConfiguration(
      { ...SAML_BODY, idpMetadata: customMetadata },
      {
        providerId: SAML_BODY.providerId,
        organizationId: SAML_BODY.orgId,
      }
    )
    if (!('samlConfig' in original)) throw new Error('Expected SAML configuration')

    const rotated = await buildSSOProviderConfiguration(
      {
        ...SAML_BODY,
        cert: '-----BEGIN CERTIFICATE-----\nROTATED\n-----END CERTIFICATE-----',
        idpMetadata: customMetadata,
      },
      {
        providerId: SAML_BODY.providerId,
        organizationId: SAML_BODY.orgId,
        existingConfig: JSON.stringify(original.samlConfig),
        existingIssuer: SAML_BODY.issuer,
      }
    )
    if (!('samlConfig' in rotated)) throw new Error('Expected SAML configuration')

    expect(rotated.samlConfig.idpMetadata.metadata).toBe(customMetadata)
  })

  it('rejects a custom SAML callback on another origin', async () => {
    await expect(
      buildSSOProviderConfiguration(
        { ...SAML_BODY, callbackUrl: 'https://attacker.example/callback' },
        {
          providerId: SAML_BODY.providerId,
          organizationId: SAML_BODY.orgId,
        }
      )
    ).rejects.toMatchObject({ code: 'SSO_CALLBACK_URL_INVALID', status: 400 })
  })

  it('maps SQLSTATE 23505 to a stable conflict response', async () => {
    const response = ssoManagementErrorResponse({ code: '23505' })
    expect(response?.status).toBe(409)
    await expect(response?.json()).resolves.toMatchObject({ code: 'SSO_CONFLICT' })
  })
})
