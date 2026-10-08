import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db, ssoDomain, ssoProvider } from '@sim/db'
import { keepDomainSignInProvider, ssoProviderDomainKey } from '@sim/db/sso-primary-provider'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { normalizeSSODomain } from '@sim/utils/sso-domain'
import { and, eq, sql } from 'drizzle-orm'
import { ssoProviderOperations } from '@/lib/auth/sso/application/operations'
import { type SsoProviderConfig, ssoProviderWriter } from '@/lib/auth/sso/provider-adapter'
import { lockSsoProvider } from '@/lib/auth/sso/provider-lock'
import type { SsoRegistrationInput } from '@/lib/auth/sso/registration-input'
import { invalidateSsoPolicyCache } from '@/lib/auth/sso-policy'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import {
  authorizeOrganizationOperation,
  type OrganizationMembershipContext,
} from '@/lib/core/application/organization-authorization'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbOrTx } from '@/lib/db/types'
import { defineOrganizationConfigurationUseCase } from '@/lib/organizations/application/authorized-configuration-use-case'

const logger = createLogger('SaveSsoProvider')

export class SsoProviderSettingsError extends OrchestrationError {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string
  ) {
    super(status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'validation', message)
  }
}
function failSsoProvider(status: number, message: string, reason?: string): never {
  if (status === 403 && reason === 'SSO_DOMAIN_NOT_VERIFIED') {
    throw new ForbiddenOperationError('SSO_DOMAIN_NOT_VERIFIED', message)
  }
  throw new SsoProviderSettingsError(status, message, reason)
}

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
    const discovery: unknown = await response.json()
    if (!isRecordLike(discovery))
      return { ok: false, error: 'OIDC discovery document must be a JSON object' }
    return { ok: true, discovery }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'Unknown error') }
  }
}

export const saveSsoProvider = defineOrganizationConfigurationUseCase({
  operation: ssoProviderOperations.save,
  async execute({
    principal,
    input,
    context,
  }: {
    principal: Principal
    input: SsoRegistrationInput
    context: OrganizationMembershipContext
  }) {
    if (!isSsoEnabled) throw new OrchestrationError('validation', 'SSO is not enabled')
    if (!(await isOrganizationFeatureEntitled(context.organizationId, isSsoEnabled)))
      throw new ForbiddenOperationError(
        'ENTERPRISE_PLAN_REQUIRED',
        'SSO requires an Enterprise plan'
      )
    const body = input
    const {
      providerId,
      issuer,
      providerType,
      mapping,
      organizationId: orgId,
      jitProvisioningEnabled,
    } = body

    /**
     * Always org-scoped: an org-less provider has no `sso_domain` proof, so only
     * operators create one, via `packages/db/scripts/register-sso-provider.ts`.
     */
    const domain = normalizeSSODomain(body.domain)
    if (!domain) {
      return failSsoProvider(400, 'Enter a valid domain, for example acme.com')
    }

    /**
     * Configuring org SSO for a domain requires DNS-proven ownership; without it
     * a first-come claim lets any org wire another company's domain to their own
     * IdP. Migration 0266 grandfathered existing domains.
     */
    const verifiedDomainClause = and(
      eq(ssoDomain.organizationId, orgId),
      eq(ssoDomain.domain, domain),
      eq(ssoDomain.status, 'verified')
    )

    const isOrgDomainVerified = async (): Promise<boolean> => {
      const [verified] = await db
        .select({ id: ssoDomain.id })
        .from(ssoDomain)
        .where(verifiedDomainClause)
        .limit(1)
      return Boolean(verified)
    }

    const domainNotVerifiedResponse = () =>
      failSsoProvider(
        403,
        `Verify ownership of ${domain} before configuring SSO for it.`,
        'SSO_DOMAIN_NOT_VERIFIED'
      )

    // Fail fast before OIDC discovery; re-checked before the write to close the
    // window where the proof is removed while discovery is in flight.
    if (!(await isOrgDomainVerified())) return domainNotVerifiedResponse()

    /**
     * An org-less provider the caller created counts as theirs, so its claim on
     * a domain is not reported as another tenant's.
     */
    const isOwnedByCaller = (provider: {
      userId: string | null
      organizationId: string | null
    }): boolean =>
      provider.organizationId === orgId ||
      (provider.userId === context.userId && !provider.organizationId)

    const ownerClause = and(
      eq(ssoProvider.providerId, providerId),
      eq(ssoProvider.organizationId, orgId)
    )

    /**
     * Refuses the domain when another tenant has claimed it, or when the caller's
     * own personal provider signs it in. The caller's organization may add a
     * provider to a domain it already signs in through: the new provider waits,
     * reachable by test link, until an admin makes it the domain's primary.
     */
    const findDomainRefusal = async (executor: DbOrTx = db): Promise<void> => {
      const claims = await executor
        .select({
          userId: ssoProvider.userId,
          organizationId: ssoProvider.organizationId,
          providerId: ssoProvider.providerId,
        })
        .from(ssoProvider)
        .where(sql`${ssoProviderDomainKey} = ${domain}`)
      if (claims.some((provider) => !isOwnedByCaller(provider))) {
        logger.warn('Rejected SSO registration for domain owned by another tenant', {
          domain,
          orgId,
          userId: context.userId,
        })
        return failSsoProvider(
          409,
          'This domain is already registered for SSO by another organization.',
          'SSO_DOMAIN_ALREADY_REGISTERED'
        )
      }
      const personal = claims.find(
        (provider) =>
          !provider.organizationId &&
          typeof provider.providerId === 'string' &&
          provider.providerId !== providerId
      )
      if (personal) {
        return failSsoProvider(
          409,
          `${domain} already signs in through the provider "${personal.providerId}". Edit that provider, or give this one a different verified domain.`,
          'SSO_DOMAIN_ALREADY_ROUTED'
        )
      }
      return
    }

    /**
     * Better Auth treats `providerId` as globally unique, not per-tenant, and
     * resolves providers by that column alone. Catching the cross-tenant
     * collision here turns its opaque 422 into a 409 naming a free id.
     */
    const findProviderIdConflict = async (executor: DbOrTx = db) =>
      (
        await executor
          .select({ userId: ssoProvider.userId, organizationId: ssoProvider.organizationId })
          .from(ssoProvider)
          .where(eq(ssoProvider.providerId, providerId))
      ).find((provider) => !isOwnedByCaller(provider))

    const providerIdConflictResponse = () =>
      failSsoProvider(
        409,
        `The provider ID "${providerId}" is already taken by another organization. Provider IDs are global, so pick a unique one — for example "${suggestProviderId(providerId, domain)}". It appears in the redirect URL you register with your identity provider, so choose it before configuring the IdP.`,
        'SSO_PROVIDER_ID_TAKEN'
      )

    if (await findProviderIdConflict()) {
      logger.warn('Rejected SSO registration for providerId owned by another tenant', {
        providerId,
        orgId,
        userId: context.userId,
      })
      return providerIdConflictResponse()
    }

    await findDomainRefusal()

    const [ownedProvider] = await db
      .select({
        issuer: ssoProvider.issuer,
        oidcConfig: ssoProvider.oidcConfig,
        samlConfig: ssoProvider.samlConfig,
      })
      .from(ssoProvider)
      .where(ownerClause)
      .limit(1)
    if (
      ownedProvider &&
      !(providerType === 'oidc' ? ownedProvider.oidcConfig : ownedProvider.samlConfig)
    )
      return failSsoProvider(
        409,
        'An existing SSO provider cannot change protocols. Create a separate provider.'
      )

    const providerConfig: SsoProviderConfig = {
      providerId,
      issuer,
      domain,
      organizationId: orgId,
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

      const existing = ownedProvider
      let stored: Record<string, unknown> = {}
      if (existing?.oidcConfig) {
        try {
          stored = toRecord(JSON.parse(existing.oidcConfig))
        } catch {
          return failSsoProvider(400, 'Cannot update invalid OIDC configuration.')
        }
      }
      let clientSecret = rawClientSecret
      if (rawClientSecret === REDACTED_MARKER) {
        const secret = toStringOrNull(stored.clientSecret)
        if (!secret) return failSsoProvider(400, 'Re-enter your client secret.')
        clientSecret = secret
      }
      const existingTokenMethod =
        existing?.issuer === issuer ? stored.tokenEndpointAuthentication : undefined

      const oidcConfig: NonNullable<SsoProviderConfig['oidcConfig']> = {
        clientId,
        clientSecret,
        tokenEndpointAuthentication:
          existingTokenMethod === 'client_secret_basic' ||
          existingTokenMethod === 'client_secret_post'
            ? existingTokenMethod
            : undefined,
        authorizationEndpoint,
        tokenEndpoint,
        userInfoEndpoint,
        jwksEndpoint,
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
            return failSsoProvider(
              400,
              `OIDC ${name} failed security validation: ${endpointValidation.error}`
            )
          }
        }
      }

      const needsDiscovery =
        !oidcConfig.authorizationEndpoint || !oidcConfig.tokenEndpoint || !oidcConfig.jwksEndpoint

      const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      const discoveryResult = await runWithOutboundOrganization(context.organizationId, () =>
        fetchOIDCDiscoveryDocument(discoveryUrl)
      )

      if (needsDiscovery) {
        logger.info('Fetching OIDC discovery document for missing endpoints', {
          discoveryUrl,
          hasAuthEndpoint: !!oidcConfig.authorizationEndpoint,
          hasTokenEndpoint: !!oidcConfig.tokenEndpoint,
          hasJwksEndpoint: !!oidcConfig.jwksEndpoint,
        })

        if (!discoveryResult.ok) {
          logger.error('Failed to fetch OIDC discovery document', { discoveryResult })
          return failSsoProvider(
            400,
            `Failed to fetch OIDC discovery document: ${discoveryResult.error}. Provide all endpoints explicitly or verify the issuer URL.`
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
              return failSsoProvider(
                400,
                `Discovered OIDC ${key} failed security validation: ${endpointValidation.error}`
              )
            }
          }
        }

        oidcConfig.authorizationEndpoint =
          oidcConfig.authorizationEndpoint ||
          toStringOrNull(discovery.authorization_endpoint) ||
          undefined
        oidcConfig.tokenEndpoint =
          oidcConfig.tokenEndpoint || toStringOrNull(discovery.token_endpoint) || undefined
        oidcConfig.userInfoEndpoint =
          oidcConfig.userInfoEndpoint || toStringOrNull(discovery.userinfo_endpoint) || undefined
        oidcConfig.jwksEndpoint =
          oidcConfig.jwksEndpoint || toStringOrNull(discovery.jwks_uri) || undefined
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
        return failSsoProvider(
          400,
          `Missing required OIDC endpoints: ${missing.join(', ')}. Please provide these explicitly or verify the issuer supports OIDC discovery.`
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

      const samlConfig: NonNullable<SsoProviderConfig['samlConfig']> = {
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

    logger.info('Saving SSO provider configuration', {
      providerId,
      providerType,
      domain,
      organizationId: orgId,
    })

    const result = await db.transaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, orgId)
      await lockSsoProvider(tx, providerId)
      await authorizeOrganizationOperation(
        principal,
        ssoProviderOperations.save,
        { organizationId: orgId },
        { executor: tx, forUpdate: true }
      )
      if (await findProviderIdConflict(tx)) return providerIdConflictResponse()
      await findDomainRefusal(tx)
      const [proof] = await tx
        .select({ id: ssoDomain.id })
        .from(ssoDomain)
        .where(verifiedDomainClause)
        .limit(1)
        .for('update')
      if (!proof) return domainNotVerifiedResponse()
      const [existing] = await tx
        .select()
        .from(ssoProvider)
        .where(ownerClause)
        .limit(1)
        .for('update')
      if (existing && !(providerType === 'oidc' ? existing.oidcConfig : existing.samlConfig))
        return failSsoProvider(
          409,
          'An existing SSO provider cannot change protocols. Create a separate provider.'
        )
      if (existing?.oidcConfig && providerConfig.oidcConfig && body.providerType === 'oidc') {
        const current = toRecord(JSON.parse(existing.oidcConfig))
        if (body.clientSecret === REDACTED_MARKER) {
          const secret = toStringOrNull(current.clientSecret)
          if (!secret) return failSsoProvider(400, 'Re-enter your client secret.')
          providerConfig.oidcConfig.clientSecret = secret
        }
        if (
          existing.issuer === issuer &&
          (current.tokenEndpointAuthentication === 'client_secret_basic' ||
            current.tokenEndpointAuthentication === 'client_secret_post')
        )
          providerConfig.oidcConfig.tokenEndpointAuthentication =
            current.tokenEndpointAuthentication
      }
      const writer = await ssoProviderWriter(principal, orgId, tx)
      let rowId: string
      if (existing) {
        await writer.update(
          {
            providerId,
            issuer,
            domain,
            ...(providerConfig.oidcConfig ? { oidcConfig: providerConfig.oidcConfig } : {}),
            ...(providerConfig.samlConfig ? { samlConfig: providerConfig.samlConfig } : {}),
          },
          { clearUserInfoEndpoint: body.providerType === 'oidc' && body.skipUserInfoEndpoint }
        )
        rowId = existing.id
      } else {
        const registration = await writer.register(providerConfig).catch((error: unknown) => {
          if (getPostgresErrorCode(error) === '23505')
            throw new OrchestrationError(
              'conflict',
              'The provider ID was claimed during registration. Reload the providers and retry.'
            )
          throw error
        })
        rowId = registration.id
      }
      const granted = await tx
        .update(ssoProvider)
        .set({ domainVerified: true, jitProvisioningEnabled })
        .where(and(ownerClause, eq(ssoProvider.id, rowId)))
        .returning({ id: ssoProvider.id })
      if (!granted.length)
        throw new OrchestrationError('conflict', 'The provider changed during registration.')
      if (!existing || !existing.domainVerified || normalizeSSODomain(existing.domain) !== domain)
        await keepDomainSignInProvider(tx, {
          domainRecordId: proof.id,
          organizationId: orgId,
          domain,
          joiningProviderId: providerId,
        })
      return {
        created: !existing,
        providerId,
        providerType,
        message: `${providerType.toUpperCase()} provider ${existing ? 'updated' : 'registered'} successfully`,
      }
    })
    invalidateSsoPolicyCache(orgId)
    return result
  },
  projectAudit: ({ input, context, result }) => ({
    action: result.created
      ? AuditAction.ORGANIZATION_SSO_PROVIDER_CREATED
      : AuditAction.ORGANIZATION_SSO_PROVIDER_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: context.organizationId,
    description: result.created
      ? 'Created organization SSO provider'
      : 'Updated organization SSO provider',
    metadata: {
      providerId: result.providerId,
      providerType: result.providerType,
      domain: normalizeSSODomain(input.domain),
      jitProvisioningEnabled: input.jitProvisioningEnabled,
    },
  }),
})
