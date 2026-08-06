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
 * Proposes a free, tenant-scoped provider ID by suffixing the domain's first
 * label (`azure-ad` + `acme.com` -> `azure-ad-acme`), so a caller who hit the
 * global-uniqueness collision is handed something concrete to type rather than
 * being asked to invent a name. Callers pass a domain that already went through
 * `normalizeSSODomain`, whose `^[a-z0-9-]+(\.[a-z0-9-]+)+$` shape guarantees a
 * non-empty first label needing no further sanitizing.
 */
function suggestProviderId(providerId: string, domain: string): string {
  return `${providerId}-${domain.split('.')[0]}`
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
      return NextResponse.json(
        { error: 'Enter a valid domain, for example acme.com' },
        { status: 400 }
      )
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
          error: `Verify ownership of ${domain} under Verified domains above before configuring SSO for it.`,
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

    /**
     * Better Auth treats `providerId` as globally unique, not per-tenant:
     * `registerSSOProvider` rejects any id already present regardless of owner,
     * and `checkProviderAccess` resolves providers by that column alone. Catch
     * the cross-tenant collision here so the caller gets an actionable 409 that
     * names a free id, instead of Better Auth's opaque 422 ("SSO provider with
     * this providerId already exists") that gives no hint anything can be done.
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

      /**
       * Persist only IdP metadata the admin actually supplied, and always write the
       * key so clearing it takes effect. Two failures sat here: a document generated
       * from `cert` + `entryPoint` used to be stored unconditionally, and the form
       * loads metadata back and resends it, so it won over the certificate and a
       * cert rotation silently did nothing. Omitting the key instead is no fix —
       * Better Auth merges SAML config with `??`, so a previously stored document
       * would survive. An empty string is written instead, which `createIdP`
       * falsy-guards, falling back to issuer/entryPoint/cert — the fields the form
       * actually edits.
       */
      samlConfig.idpMetadata = { metadata: idpMetadata ?? '' }

      if (audience) samlConfig.audience = audience
      if (wantAssertionsSigned !== undefined) samlConfig.wantAssertionsSigned = wantAssertionsSigned
      if (signatureAlgorithm) samlConfig.signatureAlgorithm = signatureAlgorithm
      if (digestAlgorithm) samlConfig.digestAlgorithm = digestAlgorithm
      // Forward an explicit empty string rather than dropping it: Better Auth
      // merges SAML config with `??`, so omitting the key would retain a
      // previously stored format while the caller asked for the provider default.
      // samlify falsy-guards nameIDFormat, so '' correctly reads as unset.
      if (identifierFormat !== undefined) samlConfig.identifierFormat = identifierFormat
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
    const [existingOwnedProvider] = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(ownerClause)
      .limit(1)

    /**
     * Unconditional write of Better Auth's `domainVerified` flag — the value Sim
     * mirrors from its own DNS proof, and what lets an SSO sign-in auto-link to an
     * existing same-email account. Used to withdraw trust, and to set the org-less
     * (personal) verdict, which {@link grantProviderDomainTrust} decides from the
     * deployment rather than from a domain. Granting on an org-scoped provider goes
     * through that same helper, which re-tests ownership in the write itself.
     */
    const setProviderDomainVerified = async (verified: boolean) => {
      await db.update(ssoProvider).set({ domainVerified: verified }).where(ownerClause)
    }

    /**
     * Grants domain trust only while the proof is held under a row lock.
     *
     * Folding the ownership test into the UPDATE's WHERE clause is not sufficient:
     * under READ COMMITTED the EXISTS subquery is evaluated against the statement's
     * original snapshot, so a delete committing while the UPDATE waits on the
     * provider row can still leave the subquery seeing the removed sso_domain row —
     * granting trust after ownership is gone. Taking `FOR SHARE` on that row inside
     * a transaction makes the two operations order properly: the delete's removal of
     * sso_domain blocks until this commits, and if it committed first the SELECT
     * finds nothing and no trust is written.
     *
     * Org-less (personal) SSO is a self-host-only path — Sim's UI always registers
     * org-scoped. It has no verified domain behind it, so it is trusted only when
     * self-hosted, where the operator is the sole tenant. On the hosted deployment
     * that trust would let anyone claim a domain they do not own.
     */
    const grantProviderDomainTrust = async (): Promise<boolean> => {
      if (!orgId) {
        await setProviderDomainVerified(!isHosted)
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

        await tx.update(ssoProvider).set({ domainVerified: true }).where(ownerClause)
        return true
      })
    }

    if (existingOwnedProvider) {
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

      // No newly-created row to roll back here, so clear the flag instead:
      // `updateSSOProvider` only resets it when the domain changes, so a
      // same-domain edit would otherwise leave stale trust standing.
      if (!(await grantProviderDomainTrust())) {
        await setProviderDomainVerified(false)
        logger.warn('Revoked SSO domain trust: verification was removed mid-update', {
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

    // A refused grant means the verified sso_domain row was removed between the
    // pre-write check and Better Auth persisting the provider, leaving a provider
    // on a domain the org no longer proves — roll it back. registerSSOProvider is
    // create-only, so a successful call always created a brand-new row; we delete
    // by its primary-key `id`, not the logical providerId, which a concurrent
    // delete+recreate could point at a different row.
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
