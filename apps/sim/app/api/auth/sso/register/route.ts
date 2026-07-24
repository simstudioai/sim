import { db, member, ssoDomain, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { ssoRegistrationContract } from '@/lib/api/contracts/auth'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import { normalizeSSODomain } from '@/lib/auth/sso/domain'
import { hasSSOAccess } from '@/lib/billing'
import { env } from '@/lib/core/config/env'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SSORegisterRoute')

type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post'

/**
 * Prefers client_secret_post over client_secret_basic when an IdP supports both:
 * better-auth sends client_secret_basic credentials without URL-encoding per
 * RFC 6749 §2.3.1, so a '+' in the client secret is decoded as a space, causing
 * invalid_client errors. Matches the same default in register-sso-provider.ts.
 */
function selectTokenEndpointAuthMethod(
  supportedMethods: unknown,
  existing?: TokenEndpointAuthMethod
): TokenEndpointAuthMethod {
  if (existing) return existing
  if (!Array.isArray(supportedMethods) || supportedMethods.length === 0) {
    return 'client_secret_post'
  }
  if (supportedMethods.includes('client_secret_post')) return 'client_secret_post'
  if (supportedMethods.includes('client_secret_basic')) return 'client_secret_basic'
  return 'client_secret_post'
}

type DiscoveryResult =
  | { ok: true; discovery: Record<string, unknown> }
  | { ok: false; error: string }

const OIDC_DISCOVERY_TIMEOUT_MS = 10000

async function fetchOIDCDiscoveryDocument(discoveryUrl: string): Promise<DiscoveryResult> {
  const urlValidation = await validateUrlWithDNS(discoveryUrl, 'OIDC discovery URL')
  if (!urlValidation.isValid || !urlValidation.resolvedIP) {
    return { ok: false, error: urlValidation.error ?? 'SSRF validation failed' }
  }

  try {
    const response = await secureFetchWithPinnedIP(discoveryUrl, urlValidation.resolvedIP, {
      headers: { Accept: 'application/json' },
      timeout: OIDC_DISCOVERY_TIMEOUT_MS,
    })
    if (!response.ok) {
      return { ok: false, error: `Discovery request failed with status ${response.status}` }
    }
    return { ok: true, discovery: (await response.json()) as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'Unknown error') }
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    if (!env.SSO_ENABLED) {
      return NextResponse.json({ error: 'SSO is not enabled' }, { status: 400 })
    }

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const hasAccess = await hasSSOAccess(session.user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'SSO requires an Enterprise plan' }, { status: 403 })
    }

    const parsed = await parseRequest(
      ssoRegistrationContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn('Invalid SSO registration request', { errors: error.issues })
          return NextResponse.json(
            { error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const body = parsed.data.body
    const { providerId, issuer, providerType, mapping, orgId } = body

    if (orgId) {
      const [membership] = await db
        .select({ organizationId: member.organizationId, role: member.role })
        .from(member)
        .where(and(eq(member.userId, session.user.id), eq(member.organizationId, orgId)))
        .limit(1)
      if (!membership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (membership.role !== 'owner' && membership.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const domain = normalizeSSODomain(body.domain)
    if (!domain) {
      return NextResponse.json({ error: 'Enter a valid domain like company.com' }, { status: 400 })
    }

    // Security gate: configuring org SSO for a domain requires the org to have
    // proven ownership of it (DNS TXT verification). Without this, the old
    // first-come claim let any org wire another company's domain to their own
    // IdP — an account-takeover primitive. Existing domains were grandfathered
    // as verified by migration 0266, so live tenants are unaffected. Personal
    // (org-less) SSO is not gated.
    const isOrgDomainVerified = async (): Promise<boolean> => {
      if (!orgId) return true
      const [verified] = await db
        .select({ id: ssoDomain.id })
        .from(ssoDomain)
        .where(
          and(
            eq(ssoDomain.organizationId, orgId),
            eq(ssoDomain.domain, domain),
            eq(ssoDomain.status, 'verified')
          )
        )
        .limit(1)
      return Boolean(verified)
    }

    const domainNotVerifiedResponse = () =>
      NextResponse.json(
        {
          error: `Verify ownership of ${domain} under Settings → Verified domains before configuring SSO for it.`,
          code: 'SSO_DOMAIN_NOT_VERIFIED',
        },
        { status: 403 }
      )

    // Fail fast before the expensive OIDC discovery. Re-checked immediately
    // before the provider write below to close the TOCTOU window (the verified
    // row could be removed while discovery is in flight).
    if (!(await isOrgDomainVerified())) return domainNotVerifiedResponse()

    const isOwnedByCaller = (provider: {
      userId: string | null
      organizationId: string | null
    }): boolean => {
      if (provider.userId === session.user.id && !provider.organizationId) return true
      return orgId ? provider.organizationId === orgId : false
    }

    const findDomainConflict = async () =>
      (
        await db
          .select({
            userId: ssoProvider.userId,
            organizationId: ssoProvider.organizationId,
          })
          .from(ssoProvider)
          .where(sql`lower(${ssoProvider.domain}) = ${domain}`)
      ).find((provider) => !isOwnedByCaller(provider))

    const domainConflictResponse = () =>
      NextResponse.json(
        {
          error: 'This domain is already registered for SSO by another organization.',
          code: 'SSO_DOMAIN_ALREADY_REGISTERED',
        },
        { status: 409 }
      )

    if (await findDomainConflict()) {
      logger.warn('Rejected SSO registration for domain owned by another tenant', {
        domain,
        orgId,
        userId: session.user.id,
      })
      return domainConflictResponse()
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headers[key] = value
    })

    const providerConfig: any = {
      providerId,
      issuer,
      domain,
      mapping,
      ...(orgId ? { organizationId: orgId } : {}),
    }

    if (providerType === 'oidc') {
      const {
        clientId,
        clientSecret: rawClientSecret,
        scopes,
        pkce,
        authorizationEndpoint,
        tokenEndpoint,
        userInfoEndpoint,
        skipUserInfoEndpoint,
        jwksEndpoint,
      } = body

      let clientSecret = rawClientSecret
      if (rawClientSecret === REDACTED_MARKER) {
        const ownerClause = orgId
          ? and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.organizationId, orgId))
          : and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.userId, session.user.id))
        const [existing] = await db
          .select({ oidcConfig: ssoProvider.oidcConfig })
          .from(ssoProvider)
          .where(ownerClause)
          .limit(1)
        if (!existing?.oidcConfig) {
          return NextResponse.json(
            { error: 'Cannot update: existing provider not found. Re-enter your client secret.' },
            { status: 400 }
          )
        }
        try {
          clientSecret = JSON.parse(existing.oidcConfig).clientSecret
        } catch {
          return NextResponse.json(
            {
              error: 'Cannot update: failed to read existing secret. Re-enter your client secret.',
            },
            { status: 400 }
          )
        }
      }

      const oidcConfig: any = {
        clientId,
        clientSecret,
        scopes: Array.isArray(scopes)
          ? scopes.filter((s: string) => s !== 'offline_access')
          : ['openid', 'profile', 'email'].filter((s: string) => s !== 'offline_access'),
        pkce: pkce ?? true,
      }

      oidcConfig.authorizationEndpoint = authorizationEndpoint
      oidcConfig.tokenEndpoint = tokenEndpoint
      oidcConfig.userInfoEndpoint = userInfoEndpoint
      oidcConfig.jwksEndpoint = jwksEndpoint

      const userProvidedEndpoints: Record<string, string | undefined> = {
        authorizationEndpoint,
        tokenEndpoint,
        jwksEndpoint,
        ...(skipUserInfoEndpoint ? {} : { userInfoEndpoint }),
      }

      for (const [name, endpointUrl] of Object.entries(userProvidedEndpoints)) {
        if (endpointUrl) {
          const endpointValidation = await validateUrlWithDNS(endpointUrl, `OIDC ${name}`)
          if (!endpointValidation.isValid) {
            logger.warn('Explicitly provided OIDC endpoint failed SSRF validation', {
              endpoint: name,
              url: endpointUrl,
              error: endpointValidation.error,
            })
            return NextResponse.json(
              {
                error: `OIDC ${name} failed security validation: ${endpointValidation.error}`,
              },
              { status: 400 }
            )
          }
        }
      }

      const needsDiscovery =
        !oidcConfig.authorizationEndpoint || !oidcConfig.tokenEndpoint || !oidcConfig.jwksEndpoint

      const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      const discoveryResult = await fetchOIDCDiscoveryDocument(discoveryUrl)

      if (needsDiscovery) {
        logger.info('Fetching OIDC discovery document for missing endpoints', {
          discoveryUrl,
          hasAuthEndpoint: !!oidcConfig.authorizationEndpoint,
          hasTokenEndpoint: !!oidcConfig.tokenEndpoint,
          hasJwksEndpoint: !!oidcConfig.jwksEndpoint,
        })

        if (!discoveryResult.ok) {
          logger.error('Failed to fetch OIDC discovery document', { discoveryResult })
          return NextResponse.json(
            {
              error: `Failed to fetch OIDC discovery document: ${discoveryResult.error}. Provide all endpoints explicitly or verify the issuer URL.`,
            },
            { status: 400 }
          )
        }

        const { discovery } = discoveryResult

        const discoveredEndpoints: Record<string, unknown> = {
          authorization_endpoint: discovery.authorization_endpoint,
          token_endpoint: discovery.token_endpoint,
          jwks_uri: discovery.jwks_uri,
          ...(skipUserInfoEndpoint ? {} : { userinfo_endpoint: discovery.userinfo_endpoint }),
        }

        for (const [key, value] of Object.entries(discoveredEndpoints)) {
          if (typeof value === 'string') {
            const endpointValidation = await validateUrlWithDNS(value, `OIDC ${key}`)
            if (!endpointValidation.isValid) {
              logger.warn('OIDC discovered endpoint failed SSRF validation', {
                endpoint: key,
                url: value,
                error: endpointValidation.error,
              })
              return NextResponse.json(
                {
                  error: `Discovered OIDC ${key} failed security validation: ${endpointValidation.error}`,
                },
                { status: 400 }
              )
            }
          }
        }

        oidcConfig.authorizationEndpoint =
          oidcConfig.authorizationEndpoint || discovery.authorization_endpoint
        oidcConfig.tokenEndpoint = oidcConfig.tokenEndpoint || discovery.token_endpoint
        oidcConfig.userInfoEndpoint = oidcConfig.userInfoEndpoint || discovery.userinfo_endpoint
        oidcConfig.jwksEndpoint = oidcConfig.jwksEndpoint || discovery.jwks_uri
        oidcConfig.tokenEndpointAuthentication = selectTokenEndpointAuthMethod(
          discovery.token_endpoint_auth_methods_supported,
          oidcConfig.tokenEndpointAuthentication
        )

        logger.info('Merged OIDC endpoints (user-provided + discovery)', {
          providerId,
          issuer,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          userInfoEndpoint: oidcConfig.userInfoEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
          tokenEndpointAuthentication: oidcConfig.tokenEndpointAuthentication,
        })
      } else {
        logger.info('Using explicitly provided OIDC endpoints (all present)', {
          providerId,
          issuer,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          userInfoEndpoint: oidcConfig.userInfoEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })

        if (!discoveryResult.ok) {
          logger.info('OIDC discovery unavailable; falling back to the default token auth method', {
            providerId,
            discoveryUrl,
          })
        }
        oidcConfig.tokenEndpointAuthentication = selectTokenEndpointAuthMethod(
          discoveryResult.ok
            ? discoveryResult.discovery.token_endpoint_auth_methods_supported
            : undefined,
          oidcConfig.tokenEndpointAuthentication
        )
      }

      if (skipUserInfoEndpoint) {
        oidcConfig.userInfoEndpoint = undefined
        logger.info('Skipping UserInfo endpoint for provider, claims will come from the ID token', {
          providerId,
        })
      }

      if (
        !oidcConfig.authorizationEndpoint ||
        !oidcConfig.tokenEndpoint ||
        !oidcConfig.jwksEndpoint
      ) {
        const missing: string[] = []
        if (!oidcConfig.authorizationEndpoint) missing.push('authorizationEndpoint')
        if (!oidcConfig.tokenEndpoint) missing.push('tokenEndpoint')
        if (!oidcConfig.jwksEndpoint) missing.push('jwksEndpoint')

        logger.error('Missing required OIDC endpoints after discovery merge', {
          missing,
          authorizationEndpoint: oidcConfig.authorizationEndpoint,
          tokenEndpoint: oidcConfig.tokenEndpoint,
          jwksEndpoint: oidcConfig.jwksEndpoint,
        })
        return NextResponse.json(
          {
            error: `Missing required OIDC endpoints: ${missing.join(', ')}. Please provide these explicitly or verify the issuer supports OIDC discovery.`,
          },
          { status: 400 }
        )
      }

      oidcConfig.skipDiscovery = true
      providerConfig.oidcConfig = oidcConfig
    } else if (providerType === 'saml') {
      const {
        entryPoint,
        cert,
        callbackUrl,
        audience,
        wantAssertionsSigned,
        signatureAlgorithm,
        digestAlgorithm,
        identifierFormat,
        idpMetadata,
      } = body

      const computedCallbackUrl =
        callbackUrl || `${getBaseUrl()}/api/auth/sso/saml2/callback/${providerId}`

      const escapeXml = (str: string) =>
        str.replace(/[<>&"']/g, (c) => {
          switch (c) {
            case '<':
              return '&lt;'
            case '>':
              return '&gt;'
            case '&':
              return '&amp;'
            case '"':
              return '&quot;'
            case "'":
              return '&apos;'
            default:
              return c
          }
        })

      const spMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(getBaseUrl())}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(computedCallbackUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`

      const certBase64 = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '')

      const computedIdpMetadataXml =
        idpMetadata ||
        `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(issuer)}">
  <IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certBase64}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(entryPoint)}"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(entryPoint)}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`

      const samlConfig: any = {
        entryPoint,
        cert,
        callbackUrl: computedCallbackUrl,
        spMetadata: {
          metadata: spMetadataXml,
        },
        idpMetadata: {
          metadata: computedIdpMetadataXml,
        },
      }

      if (audience) samlConfig.audience = audience
      if (wantAssertionsSigned !== undefined) samlConfig.wantAssertionsSigned = wantAssertionsSigned
      if (signatureAlgorithm) samlConfig.signatureAlgorithm = signatureAlgorithm
      if (digestAlgorithm) samlConfig.digestAlgorithm = digestAlgorithm
      if (identifierFormat) samlConfig.identifierFormat = identifierFormat

      providerConfig.samlConfig = samlConfig
    }

    logger.info('Calling Better Auth registerSSOProvider with config:', {
      providerId: providerConfig.providerId,
      domain: providerConfig.domain,
      hasOidcConfig: !!providerConfig.oidcConfig,
      hasSamlConfig: !!providerConfig.samlConfig,
      samlConfigKeys: providerConfig.samlConfig ? Object.keys(providerConfig.samlConfig) : [],
      fullConfig: JSON.stringify(
        {
          ...providerConfig,
          oidcConfig: providerConfig.oidcConfig
            ? {
                ...providerConfig.oidcConfig,
                clientSecret: REDACTED_MARKER,
              }
            : undefined,
          samlConfig: providerConfig.samlConfig
            ? {
                ...providerConfig.samlConfig,
                cert: REDACTED_MARKER,
              }
            : undefined,
        },
        null,
        2
      ),
    })

    if (await findDomainConflict()) {
      logger.warn('Rejected SSO registration: domain was claimed during registration', {
        domain,
        orgId,
        userId: session.user.id,
      })
      return domainConflictResponse()
    }

    // Authoritative verification re-check: the verified row could have been
    // removed during OIDC discovery. Re-checking here (not just at handler
    // entry) ensures ownership still holds at the moment of the write.
    if (!(await isOrgDomainVerified())) {
      logger.warn(
        'Rejected SSO registration: domain verification was revoked during registration',
        {
          domain,
          orgId,
          userId: session.user.id,
        }
      )
      return domainNotVerifiedResponse()
    }

    // Record whether this (providerId, orgId) already existed BEFORE the write,
    // so the compensating delete below can only ever remove a provider WE just
    // created. registerSSOProvider is create-only today (it throws if the
    // providerId already exists), so this is belt-and-suspenders — but it makes
    // the rollback's safety local and independent of Better Auth's internals: if
    // a future version ever allowed updating an existing provider, we must not
    // delete that pre-existing row on a revoked-verification rollback.
    let providerExistedBefore = false
    if (orgId) {
      const [prior] = await db
        .select({ id: ssoProvider.id })
        .from(ssoProvider)
        .where(and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.organizationId, orgId)))
        .limit(1)
      providerExistedBefore = Boolean(prior)
    }

    const registration = await auth.api.registerSSOProvider({
      body: providerConfig,
      headers,
    })

    // Close the residual TOCTOU between the re-check above and Better Auth
    // persisting the provider: the verified sso_domain row could be removed in
    // that window. Only roll back a provider this request just created (guarded
    // by providerExistedBefore), scoped to (providerId, orgId). Personal SSO is
    // not gated, so this only runs for org-scoped registration.
    if (orgId && !providerExistedBefore && !(await isOrgDomainVerified())) {
      await db
        .delete(ssoProvider)
        .where(
          and(
            eq(ssoProvider.providerId, registration.providerId),
            eq(ssoProvider.organizationId, orgId)
          )
        )
      logger.warn('Rolled back SSO provider: domain verification revoked mid-registration', {
        domain,
        orgId,
        providerId: registration.providerId,
        userId: session.user.id,
      })
      return domainNotVerifiedResponse()
    }

    logger.info('SSO provider registered successfully', {
      providerId,
      providerType,
      domain,
    })

    return NextResponse.json({
      success: true,
      providerId: registration.providerId,
      providerType,
      message: `${providerType.toUpperCase()} provider registered successfully`,
    })
  } catch (error) {
    logger.error('Failed to register SSO provider', {
      error,
      errorMessage: getErrorMessage(error, 'Unknown error'),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorDetails: JSON.stringify(error),
    })

    return NextResponse.json(
      {
        error: 'Failed to register SSO provider',
        details: getErrorMessage(error, 'Unknown error'),
      },
      { status: 500 }
    )
  }
})
