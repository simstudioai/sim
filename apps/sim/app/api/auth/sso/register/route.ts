import { db, member, ssoDomain, ssoProvider } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { ssoRegistrationContract } from '@/lib/api/contracts/auth'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth'
import { hasSSOAccess } from '@/lib/billing'
import { isHosted, isSsoEnabled } from '@/lib/core/config/env-flags'
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

/**
 * Proposes a free provider ID by suffixing the domain's first label
 * (`azure-ad` + `acme.com` -> `azure-ad-acme`). Callers pass a domain already
 * through `normalizeSSODomain`, whose shape guarantees a non-empty first label.
 */
function suggestProviderId(providerId: string, domain: string): string {
  return `${providerId}-${domain.split('.')[0]}`
}

type DiscoveryResult =
  | { ok: true; discovery: Record<string, unknown> }
  | { ok: false; error: string }

const OIDC_DISCOVERY_TIMEOUT_MS = 10000

async function fetchOIDCDiscoveryDocument(discoveryUrl: string): Promise<DiscoveryResult> {
  const urlValidation = await validateUrlWithDNS(
    discoveryUrl,
    'OIDC discovery URL',
    'configuredEndpoint'
  )
  if (!urlValidation.isValid) {
    return { ok: false, error: urlValidation.error }
  }

  try {
    const response = await secureFetchWithPinnedIP(discoveryUrl, urlValidation.resolvedIP, {
      profile: 'configuredEndpoint',
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
    if (!isSsoEnabled) {
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
    const { providerId, issuer, providerType, mapping, orgId, jitProvisioningEnabled } = body

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
      return NextResponse.json(
        { error: 'Enter a valid domain, for example acme.com' },
        { status: 400 }
      )
    }

    /**
     * Configuring org SSO for a domain requires DNS-proven ownership; without it
     * a first-come claim lets any org wire another company's domain to their own
     * IdP. Migration 0266 grandfathered existing domains. Org-less SSO is not gated.
     */
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
          error: `Verify ownership of ${domain} under Verified domains above before configuring SSO for it.`,
          code: 'SSO_DOMAIN_NOT_VERIFIED',
        },
        { status: 403 }
      )

    // Fail fast before OIDC discovery; re-checked before the write to close the
    // window where the proof is removed while discovery is in flight.
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

    /**
     * Better Auth treats `providerId` as globally unique, not per-tenant, and
     * resolves providers by that column alone. Catching the cross-tenant
     * collision here turns its opaque 422 into a 409 naming a free id.
     */
    const findProviderIdConflict = async () =>
      (
        await db
          .select({
            userId: ssoProvider.userId,
            organizationId: ssoProvider.organizationId,
          })
          .from(ssoProvider)
          .where(eq(ssoProvider.providerId, providerId))
      ).find((provider) => !isOwnedByCaller(provider))

    const providerIdConflictResponse = () =>
      NextResponse.json(
        {
          error: `The provider ID "${providerId}" is already taken by another organization. Provider IDs are global, so pick a unique one — for example "${suggestProviderId(providerId, domain)}". It appears in the redirect URL you register with your identity provider, so choose it before configuring the IdP.`,
          code: 'SSO_PROVIDER_ID_TAKEN',
        },
        { status: 409 }
      )

    if (await findProviderIdConflict()) {
      logger.warn('Rejected SSO registration for providerId owned by another tenant', {
        providerId,
        orgId,
        userId: session.user.id,
      })
      return providerIdConflictResponse()
    }

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
          : and(
              eq(ssoProvider.providerId, providerId),
              eq(ssoProvider.userId, session.user.id),
              isNull(ssoProvider.organizationId)
            )
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
          const endpointValidation = await validateUrlWithDNS(
            endpointUrl,
            `OIDC ${name}`,
            'configuredEndpoint'
          )
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
            const endpointValidation = await validateUrlWithDNS(
              value,
              `OIDC ${key}`,
              'contentFetch'
            )
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
      // Better Auth reads the attribute mapping from oidcConfig.mapping, not a
      // top-level field — nesting it here is what makes a custom mapping apply.
      if (mapping) oidcConfig.mapping = mapping
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

      const samlConfig: any = {
        entryPoint,
        cert,
        callbackUrl: computedCallbackUrl,
        spMetadata: {
          metadata: spMetadataXml,
        },
      }

      if (audience) samlConfig.audience = audience
      if (wantAssertionsSigned !== undefined) samlConfig.wantAssertionsSigned = wantAssertionsSigned
      if (signatureAlgorithm) samlConfig.signatureAlgorithm = signatureAlgorithm
      if (digestAlgorithm) samlConfig.digestAlgorithm = digestAlgorithm

      /**
       * Always written, empty when unset: Better Auth merges SAML config with
       * `??`, so an omitted key keeps whatever was stored and clearing either
       * field would never take effect. Both are falsy-guarded downstream.
       *
       * Metadata must not be generated here — a document built from cert +
       * entryPoint outranks the certificate on re-save, silently defeating
       * SAML cert rotation.
       */
      samlConfig.idpMetadata = { metadata: idpMetadata ?? '' }
      samlConfig.identifierFormat = identifierFormat ?? ''
      // Better Auth reads the attribute mapping from samlConfig.mapping.
      if (mapping) samlConfig.mapping = mapping

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

    if (await findProviderIdConflict()) {
      logger.warn('Rejected SSO registration: providerId was claimed during registration', {
        providerId,
        orgId,
        userId: session.user.id,
      })
      return providerIdConflictResponse()
    }

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

    // Better Auth's registerSSOProvider is create-only (it throws on an existing
    // providerId). If the caller already owns a provider with this id, route the
    // edit through updateSSOProvider so re-saving an SSO config works instead of
    // failing. The verification gate above already ran against the target domain,
    // so an edit that moves SSO to an unverified domain is still blocked.
    // The personal branch MUST require a null org: org providers store
    // userId = their creator, so without it an org admin could send a
    // personal-mode request (which skips the membership check and the
    // verification gate) yet still match — and then update — their org's
    // provider, moving it to an unverified domain. Mirrors isOwnedByCaller.
    const ownerClause = orgId
      ? and(eq(ssoProvider.providerId, providerId), eq(ssoProvider.organizationId, orgId))
      : and(
          eq(ssoProvider.providerId, providerId),
          eq(ssoProvider.userId, session.user.id),
          isNull(ssoProvider.organizationId)
        )
    // Config columns are captured, not just the id: an update whose trust grant is
    // refused has to be undone, or the rejected config stays stored and goes live
    // the moment the domain is verified again.
    const [existingOwnedProvider] = await db
      .select({
        id: ssoProvider.id,
        issuer: ssoProvider.issuer,
        domain: ssoProvider.domain,
        oidcConfig: ssoProvider.oidcConfig,
        samlConfig: ssoProvider.samlConfig,
        jitProvisioningEnabled: ssoProvider.jitProvisioningEnabled,
      })
      .from(ssoProvider)
      .where(ownerClause)
      .limit(1)

    /**
     * Grants domain trust only while the proof is held under a row lock.
     *
     * A WHERE-clause EXISTS test is not enough: under READ COMMITTED the subquery
     * sees the statement's original snapshot, so a delete committing while the
     * UPDATE waits can still grant trust after ownership is gone. `FOR SHARE`
     * orders the two — the delete blocks until this commits, and if it committed
     * first the SELECT finds nothing.
     *
     * Org-less SSO is self-host-only (Sim's UI always registers org-scoped) and
     * has no proof behind it, so it is trusted only when self-hosted.
     */
    const grantProviderDomainTrust = async (): Promise<boolean> => {
      if (!orgId) {
        await db
          .update(ssoProvider)
          .set({ domainVerified: !isHosted, jitProvisioningEnabled })
          .where(ownerClause)
        return true
      }
      return db.transaction(async (tx) => {
        const [proof] = await tx
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
          .for('share')
        if (!proof) return false

        const granted = await tx
          .update(ssoProvider)
          .set({ domainVerified: true, jitProvisioningEnabled })
          .where(ownerClause)
          .returning({ id: ssoProvider.id })
        return granted.length > 0
      })
    }

    if (existingOwnedProvider) {
      const revertProviderUpdate = async (): Promise<void> => {
        await db
          .update(ssoProvider)
          .set({
            issuer: existingOwnedProvider.issuer,
            domain: existingOwnedProvider.domain,
            oidcConfig: existingOwnedProvider.oidcConfig,
            samlConfig: existingOwnedProvider.samlConfig,
            domainVerified: false,
            jitProvisioningEnabled: existingOwnedProvider.jitProvisioningEnabled,
          })
          .where(eq(ssoProvider.id, existingOwnedProvider.id))
      }

      await auth.api.updateSSOProvider({
        body: {
          providerId,
          issuer,
          domain,
          ...(providerConfig.oidcConfig ? { oidcConfig: providerConfig.oidcConfig } : {}),
          ...(providerConfig.samlConfig ? { samlConfig: providerConfig.samlConfig } : {}),
        },
        headers,
      })

      let domainTrustGranted: boolean
      try {
        domainTrustGranted = await grantProviderDomainTrust()
      } catch (error) {
        try {
          await revertProviderUpdate()
        } catch (rollbackError) {
          logger.error('Failed to revert SSO provider after domain trust write failed', {
            domain,
            orgId,
            providerId,
            userId: session.user.id,
            error,
            rollbackError,
          })
        }
        throw error
      }

      // Restore the pre-update config and clear the flag together. Clearing alone
      // is not enough: re-verifying the domain now regrants trust automatically,
      // which would activate the very config this request reported as rejected.
      if (!domainTrustGranted) {
        await revertProviderUpdate()
        logger.warn('Reverted SSO update: domain verification was removed mid-write', {
          domain,
          orgId,
          providerId,
          userId: session.user.id,
        })
        return domainNotVerifiedResponse()
      }

      logger.info('SSO provider updated successfully', { providerId, providerType, domain })
      return NextResponse.json({
        success: true,
        providerId,
        providerType,
        message: `${providerType.toUpperCase()} provider updated successfully`,
      })
    }

    const registration = await auth.api.registerSSOProvider({
      body: providerConfig,
      headers,
    })

    // A refused grant means the proof vanished mid-write, leaving a provider on a
    // domain the org no longer proves — roll it back. Deleted by primary key, not
    // providerId, which a concurrent delete+recreate could point at another row.
    if (!(await grantProviderDomainTrust())) {
      // registerSSOProvider spreads the created row's `id` at runtime, but the
      // typed return omits it — read it defensively and only delete when it's a
      // real id, so a future shape change can't turn the rollback into a silent
      // no-op that leaves a provider on an unverified domain. `orgId` is checked
      // only to narrow it: the org-less path grants unconditionally, so a refused
      // grant always means an org-scoped registration.
      // double-cast-allowed: Better Auth's return type omits the runtime `id`
      const createdRowId = (registration as unknown as { id?: unknown }).id
      if (orgId && typeof createdRowId === 'string' && createdRowId.length > 0) {
        await db
          .delete(ssoProvider)
          .where(and(eq(ssoProvider.id, createdRowId), eq(ssoProvider.organizationId, orgId)))
        logger.warn('Rolled back SSO provider: domain verification revoked mid-registration', {
          domain,
          orgId,
          providerId: registration.providerId,
          userId: session.user.id,
        })
      } else {
        logger.error('Could not roll back SSO provider: registration returned no usable id', {
          domain,
          orgId,
          providerId: registration.providerId,
          userId: session.user.id,
        })
      }
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
    logger.error('Failed to save SSO provider', {
      error,
      errorMessage: getErrorMessage(error, 'Unknown error'),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorDetails: JSON.stringify(error),
    })

    // Surface Better Auth's own APIError (e.g. a 409 when identity fields change
    // while linked accounts exist, or a 404) with its status and message instead
    // of a generic 500, so the client shows an actionable error.
    const apiError = error as { statusCode?: unknown; body?: { message?: unknown } }
    if (typeof apiError.statusCode === 'number' && typeof apiError.body?.message === 'string') {
      return NextResponse.json({ error: apiError.body.message }, { status: apiError.statusCode })
    }

    return NextResponse.json(
      {
        error: 'Failed to save the SSO provider',
        details: getErrorMessage(error, 'Unknown error'),
      },
      { status: 500 }
    )
  }
})
