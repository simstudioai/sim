#!/usr/bin/env bun

/**
 * Audited Direct Database SSO Registration Script
 *
 * This script bypasses the authentication requirement by directly inserting
 * SSO provider records into the database while enforcing Sim's organization,
 * domain, provider-ID, verification-reset, and account-link invariants.
 *
 * Usage: bun run packages/db/scripts/register-sso-provider.ts
 *
 * Required Environment Variables:
 *   SSO_ENABLED=true
 *   SSO_PROVIDER_TYPE=oidc|saml
 *   SSO_PROVIDER_ID=your-provider-id
 *   SSO_ISSUER=https://your-idp-url
 *   SSO_DOMAIN=your-email-domain.com
 *   SSO_USER_EMAIL=admin@yourdomain.com (must be existing user)
 *   SSO_ORGANIZATION_ID=your-organization-id (user must be an owner/admin)
 *
 * OIDC Providers:
 *   SSO_OIDC_CLIENT_ID=your_client_id
 *   SSO_OIDC_CLIENT_SECRET=your_client_secret
 *   SSO_OIDC_SCOPES=openid,profile,email (optional)
 *   SSO_OIDC_TOKEN_ENDPOINT_AUTH=client_secret_post|client_secret_basic (optional, defaults to client_secret_post)
 *   SSO_OIDC_SKIP_USERINFO_ENDPOINT=true (optional; reads claims from the verified ID token
 *     instead of calling the discovered UserInfo endpoint, matching better-auth's ID-token
 *     path in its OIDC callback. Use this for IdPs whose UserInfo endpoint omits claims that
 *     are present on the ID token, e.g. Microsoft Entra ID's Graph userinfo endpoint dropping
 *     `email` for some tenants)
 *
 * SAML Providers:
 *   SSO_SAML_ENTRY_POINT=https://your-idp/sso
 *   SSO_SAML_CERT=your-certificate-pem-string
 *   SSO_SAML_CALLBACK_URL=https://yourdomain.com/api/auth/sso/saml2/callback/provider-id
 *   SSO_SAML_SP_METADATA=<custom-sp-metadata-xml> (optional, auto-generated if not provided)
 *   SSO_SAML_IDP_METADATA=<idp-metadata-xml> (optional)
 *   SSO_SAML_AUDIENCE=https://yourdomain.com (optional, defaults to SSO_ISSUER)
 *   SSO_SAML_WANT_ASSERTIONS_SIGNED=true (optional, defaults to false)
 */

import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { parse as parseDomain } from 'tldts'
import { member, organization, ssoProvider, user } from '../schema'

interface SSOMapping {
  id: string
  email: string
  name: string
  image?: string
}

interface OIDCConfig {
  clientId: string
  clientSecret: string
  scopes?: string[]
  pkce?: boolean
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userInfoEndpoint?: string
  skipUserInfoEndpoint?: boolean
  jwksEndpoint?: string
  discoveryEndpoint?: string
  tokenEndpointAuthentication?: 'client_secret_post' | 'client_secret_basic'
}

interface SAMLConfig {
  issuer?: string
  entryPoint: string
  cert: string
  callbackUrl?: string
  audience?: string
  wantAssertionsSigned?: boolean
  signatureAlgorithm?: string
  digestAlgorithm?: string
  identifierFormat?: string
  idpMetadata?: {
    metadata?: string
    entityID?: string
    cert?: string
    privateKey?: string
    privateKeyPass?: string
    isAssertionEncrypted?: boolean
    encPrivateKey?: string
    encPrivateKeyPass?: string
    singleSignOnService?: Array<{
      Binding: string
      Location: string
    }>
  }
  spMetadata?: {
    metadata?: string
    entityID?: string
    binding?: string
    privateKey?: string
    privateKeyPass?: string
    isAssertionEncrypted?: boolean
    encPrivateKey?: string
    encPrivateKeyPass?: string
  }
  privateKey?: string
  decryptionPvk?: string
  additionalParams?: Record<string, unknown>
}

interface SSOProviderConfig {
  providerId: string
  issuer: string
  domain: string
  providerType: 'oidc' | 'saml'
  mapping?: SSOMapping
  oidcConfig?: OIDCConfig
  samlConfig?: SAMLConfig
}

const logger = {
  info: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.log(
      `[${timestamp}] [INFO] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  error: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.error(
      `[${timestamp}] [ERROR] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
  warn: (message: string, meta?: any) => {
    const timestamp = new Date().toISOString()
    console.warn(
      `[${timestamp}] [WARN] [RegisterSSODB] ${message}`,
      meta ? JSON.stringify(meta, null, 2) : ''
    )
  },
}

const CONNECTION_STRING = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!CONNECTION_STRING) {
  console.error('❌ POSTGRES_URL or DATABASE_URL environment variable is required')
  process.exit(1)
}

const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

interface SSOProviderData {
  id: string
  issuer: string
  domain: string
  oidcConfig?: string
  samlConfig?: string
  userId: string
  providerId: string
  organizationId: string
  domainVerified: boolean
}

const RESERVED_PROVIDER_IDS = new Set(['google', 'github', 'email-password'])

function normalizeProviderId(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return normalized.length <= 44 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalized) &&
    !RESERVED_PROVIDER_IDS.has(normalized)
    ? normalized
    : null
}

function normalizeDomain(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '')
  const parsed = parseDomain(normalized, { allowPrivateDomains: true, validateHostname: true })
  return parsed.hostname === normalized &&
    parsed.publicSuffix &&
    parsed.publicSuffix !== normalized &&
    !normalized.includes(',')
    ? normalized
    : null
}

function domainsOverlap(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

function buildSSOConfigFromEnv(): SSOProviderConfig | null {
  const enabled = process.env.SSO_ENABLED === 'true'
  if (!enabled) return null

  const providerId = process.env.SSO_PROVIDER_ID
  const issuer = process.env.SSO_ISSUER
  const domain = process.env.SSO_DOMAIN
  const providerType = process.env.SSO_PROVIDER_TYPE

  const normalizedProviderId = providerId ? normalizeProviderId(providerId) : null
  const normalizedDomain = domain ? normalizeDomain(domain) : null
  if (
    !normalizedProviderId ||
    !issuer ||
    !normalizedDomain ||
    (providerType !== 'oidc' && providerType !== 'saml')
  ) {
    return null
  }

  const config: SSOProviderConfig = {
    providerId: normalizedProviderId,
    issuer,
    domain: normalizedDomain,
    providerType,
  }

  config.mapping = {
    id:
      process.env.SSO_MAPPING_ID ||
      (providerType === 'oidc'
        ? 'sub'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'),
    email:
      process.env.SSO_MAPPING_EMAIL ||
      (providerType === 'oidc'
        ? 'email'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'),
    name:
      process.env.SSO_MAPPING_NAME ||
      (providerType === 'oidc'
        ? 'name'
        : 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'),
    image: process.env.SSO_MAPPING_IMAGE || (providerType === 'oidc' ? 'picture' : undefined),
  }

  if (providerType === 'oidc') {
    const clientId = process.env.SSO_OIDC_CLIENT_ID
    const clientSecret = process.env.SSO_OIDC_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      return null
    }

    config.oidcConfig = {
      clientId,
      clientSecret,
      scopes: process.env.SSO_OIDC_SCOPES?.split(',').map((s) => s.trim()) || [
        'openid',
        'profile',
        'email',
      ],
      pkce: process.env.SSO_OIDC_PKCE !== 'false',
      authorizationEndpoint: process.env.SSO_OIDC_AUTHORIZATION_ENDPOINT,
      tokenEndpoint: process.env.SSO_OIDC_TOKEN_ENDPOINT,
      tokenEndpointAuthentication:
        process.env.SSO_OIDC_TOKEN_ENDPOINT_AUTH === 'client_secret_post' ||
        process.env.SSO_OIDC_TOKEN_ENDPOINT_AUTH === 'client_secret_basic'
          ? process.env.SSO_OIDC_TOKEN_ENDPOINT_AUTH
          : undefined,
      userInfoEndpoint: process.env.SSO_OIDC_USERINFO_ENDPOINT,
      skipUserInfoEndpoint: process.env.SSO_OIDC_SKIP_USERINFO_ENDPOINT === 'true',
      jwksEndpoint: process.env.SSO_OIDC_JWKS_ENDPOINT,
      discoveryEndpoint:
        process.env.SSO_OIDC_DISCOVERY_ENDPOINT ||
        `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
    }
  } else if (providerType === 'saml') {
    const entryPoint = process.env.SSO_SAML_ENTRY_POINT
    const cert = process.env.SSO_SAML_CERT

    if (!entryPoint || !cert) {
      return null
    }

    const appBaseUrl = (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.BETTER_AUTH_URL ||
      ''
    ).replace(/\/$/, '')

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

    const callbackUrl =
      process.env.SSO_SAML_CALLBACK_URL || `${appBaseUrl}/api/auth/sso/saml2/callback/${providerId}`

    let spMetadata = process.env.SSO_SAML_SP_METADATA
    if (!spMetadata) {
      spMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(appBaseUrl)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(callbackUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`
    }

    const idpMetadataXml = process.env.SSO_SAML_IDP_METADATA
    let computedIdpMetadata: string
    if (idpMetadataXml) {
      computedIdpMetadata = idpMetadataXml
    } else {
      const certBase64 = cert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s/g, '')
      const escapedEntryPoint = escapeXml(entryPoint)
      computedIdpMetadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(issuer)}">
  <IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certBase64}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapedEntryPoint}"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapedEntryPoint}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`
    }

    config.samlConfig = {
      issuer,
      entryPoint,
      cert,
      callbackUrl,
      audience: process.env.SSO_SAML_AUDIENCE || issuer,
      wantAssertionsSigned: process.env.SSO_SAML_WANT_ASSERTIONS_SIGNED === 'true',
      signatureAlgorithm: process.env.SSO_SAML_SIGNATURE_ALGORITHM,
      digestAlgorithm: process.env.SSO_SAML_DIGEST_ALGORITHM,
      identifierFormat: process.env.SSO_SAML_IDENTIFIER_FORMAT,
      spMetadata: {
        metadata: spMetadata,
        entityID: appBaseUrl,
      },
      idpMetadata: {
        metadata: computedIdpMetadata,
      },
    }
  }

  return config
}

function getExampleEnvVars(
  providerType: 'oidc' | 'saml',
  provider?: string
): Record<string, string> {
  const baseVars = {
    SSO_ENABLED: 'true',
    SSO_PROVIDER_TYPE: providerType,
    SSO_PROVIDER_ID: provider || (providerType === 'oidc' ? 'okta' : 'adfs'),
    SSO_DOMAIN: 'yourcompany.com',
    SSO_USER_EMAIL: 'admin@yourcompany.com',
    SSO_ORGANIZATION_ID: 'your-organization-id',
  }

  if (providerType === 'oidc') {
    const examples: Record<string, Record<string, string>> = {
      okta: {
        ...baseVars,
        SSO_PROVIDER_ID: 'okta',
        SSO_ISSUER: 'https://dev-123456.okta.com/oauth2/default',
        SSO_OIDC_CLIENT_ID: '0oavhncxymgOpe06E697',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_OIDC_SCOPES: 'openid,profile,email',
      },
      'azure-ad': {
        ...baseVars,
        SSO_PROVIDER_ID: 'azure-ad',
        SSO_ISSUER: 'https://login.microsoftonline.com/{tenant-id}/v2.0',
        SSO_OIDC_CLIENT_ID: 'your-application-id',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_MAPPING_ID: 'oid',
        SSO_OIDC_SKIP_USERINFO_ENDPOINT: 'true',
      },
      generic: {
        ...baseVars,
        SSO_PROVIDER_ID: 'custom-oidc',
        SSO_ISSUER: 'https://idp.example.com',
        SSO_OIDC_CLIENT_ID: 'your-client-id',
        SSO_OIDC_CLIENT_SECRET: 'your-client-secret',
        SSO_OIDC_AUTHORIZATION_ENDPOINT: 'https://idp.example.com/auth',
        SSO_OIDC_TOKEN_ENDPOINT: 'https://idp.example.com/token',
        SSO_OIDC_USERINFO_ENDPOINT: 'https://idp.example.com/userinfo',
      },
    }
    return examples[provider || 'okta'] || examples.generic
  }

  return {
    ...baseVars,
    SSO_PROVIDER_ID: 'adfs',
    SSO_ISSUER: 'https://adfs.company.com',
    SSO_SAML_ENTRY_POINT: 'https://adfs.company.com/adfs/ls/',
    SSO_SAML_CERT:
      '-----BEGIN CERTIFICATE-----\nMIIDBjCCAe4CAQAwDQYJKoZIhvcNAQEFBQAwEjEQMA4GA1UEAwwHYWRmcy...\n-----END CERTIFICATE-----',
    SSO_SAML_AUDIENCE: 'https://yourapp.com',
    SSO_SAML_WANT_ASSERTIONS_SIGNED: 'true',
    SSO_MAPPING_ID: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
    SSO_MAPPING_EMAIL: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    SSO_MAPPING_NAME: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  }
}

async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  const adminEmail = process.env.SSO_USER_EMAIL
  if (!adminEmail) {
    logger.error('SSO_USER_EMAIL is required to identify the admin user')
    return null
  }

  try {
    const users = await db.select().from(user).where(eq(user.email, adminEmail))
    if (users.length === 0) {
      logger.error(`No user found with email: ${adminEmail}`)
      logger.error('Please ensure this user exists in your database first')
      return null
    }
    return { id: users[0].id, email: users[0].email }
  } catch (error) {
    logger.error('Failed to query user:', error)
    return null
  }
}

async function getAuditedOrganization(userId: string): Promise<string | null> {
  const organizationId = process.env.SSO_ORGANIZATION_ID?.trim()
  if (!organizationId) {
    logger.error('SSO_ORGANIZATION_ID is required; user-scoped SSO providers are unsupported')
    return null
  }

  const [organizationRow, membership] = await Promise.all([
    db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId)),
    db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId))),
  ])
  if (organizationRow.length === 0) {
    logger.error(`Organization '${organizationId}' does not exist`)
    return null
  }
  if (!membership.some(({ role }) => role === 'owner' || role === 'admin')) {
    logger.error('SSO_USER_EMAIL must be an owner or admin of SSO_ORGANIZATION_ID')
    return null
  }
  return organizationId
}

async function registerSSOProvider(): Promise<boolean> {
  try {
    const ssoConfig = buildSSOConfigFromEnv()

    if (!ssoConfig) {
      logger.error('❌ No valid SSO configuration found in environment variables')
      logger.error('')
      logger.error('📝 Required environment variables:')
      logger.error('For OIDC providers (like Okta, Azure AD):')
      const oidcExample = getExampleEnvVars('oidc', 'okta')
      for (const [key, value] of Object.entries(oidcExample)) {
        logger.error(`  ${key}=${value}`)
      }
      logger.error('  SSO_USER_EMAIL=admin@yourdomain.com')
      logger.error('')
      logger.error('For SAML providers (like ADFS):')
      const samlExample = getExampleEnvVars('saml')
      for (const [key, value] of Object.entries(samlExample)) {
        logger.error(`  ${key}=${value}`)
      }
      logger.error('  SSO_USER_EMAIL=admin@yourdomain.com')
      return false
    }

    const adminUser = await getAdminUser()
    if (!adminUser) {
      return false
    }
    const organizationId = await getAuditedOrganization(adminUser.id)
    if (!organizationId) {
      return false
    }

    logger.info('Registering SSO provider directly in database...', {
      providerId: ssoConfig.providerId,
      providerType: ssoConfig.providerType,
      domain: ssoConfig.domain,
      adminUser: adminUser.email,
    })

    try {
      const issuer = new URL(ssoConfig.issuer)
      if (!['http:', 'https:'].includes(issuer.protocol)) throw new Error('Unsupported protocol')
    } catch {
      logger.error('Invalid issuer. Must be a valid URL:', ssoConfig.issuer)
      return false
    }

    if (
      ssoConfig.providerType === 'saml' &&
      !process.env.NEXT_PUBLIC_APP_URL &&
      !process.env.BETTER_AUTH_URL
    ) {
      logger.error(
        'NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL is required for SAML — it is used as the SP entity ID in SP metadata. Set one of these env vars.'
      )
      return false
    }

    if (ssoConfig.providerType === 'oidc' && ssoConfig.oidcConfig) {
      const needsDiscovery =
        !ssoConfig.oidcConfig.authorizationEndpoint ||
        !ssoConfig.oidcConfig.tokenEndpoint ||
        !ssoConfig.oidcConfig.jwksEndpoint

      if (needsDiscovery) {
        const discoveryUrl =
          ssoConfig.oidcConfig.discoveryEndpoint ||
          `${ssoConfig.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
        logger.info('Fetching OIDC discovery document for missing endpoints...', {
          discoveryUrl,
          hasAuthEndpoint: !!ssoConfig.oidcConfig.authorizationEndpoint,
          hasTokenEndpoint: !!ssoConfig.oidcConfig.tokenEndpoint,
          hasJwksEndpoint: !!ssoConfig.oidcConfig.jwksEndpoint,
        })

        try {
          const response = await fetch(discoveryUrl, {
            headers: { Accept: 'application/json' },
          })

          if (!response.ok) {
            logger.error('Failed to fetch OIDC discovery document', {
              status: response.status,
              statusText: response.statusText,
            })
            logger.error(
              'Provide all endpoints explicitly via SSO_OIDC_AUTHORIZATION_ENDPOINT, SSO_OIDC_TOKEN_ENDPOINT, SSO_OIDC_JWKS_ENDPOINT'
            )
            return false
          }

          const discovery = await response.json()

          ssoConfig.oidcConfig.authorizationEndpoint =
            ssoConfig.oidcConfig.authorizationEndpoint || discovery.authorization_endpoint
          ssoConfig.oidcConfig.tokenEndpoint =
            ssoConfig.oidcConfig.tokenEndpoint || discovery.token_endpoint
          ssoConfig.oidcConfig.userInfoEndpoint =
            ssoConfig.oidcConfig.userInfoEndpoint || discovery.userinfo_endpoint
          ssoConfig.oidcConfig.jwksEndpoint =
            ssoConfig.oidcConfig.jwksEndpoint || discovery.jwks_uri

          logger.info('Merged OIDC endpoints (user-provided + discovery)', {
            authorizationEndpoint: ssoConfig.oidcConfig.authorizationEndpoint,
            tokenEndpoint: ssoConfig.oidcConfig.tokenEndpoint,
            userInfoEndpoint: ssoConfig.oidcConfig.userInfoEndpoint,
            jwksEndpoint: ssoConfig.oidcConfig.jwksEndpoint,
          })
        } catch (error) {
          logger.error('Error fetching OIDC discovery document', {
            error: getErrorMessage(error, 'Unknown error'),
            discoveryUrl,
          })
          logger.error(
            'Please provide explicit endpoints via SSO_OIDC_AUTHORIZATION_ENDPOINT, SSO_OIDC_TOKEN_ENDPOINT, SSO_OIDC_JWKS_ENDPOINT'
          )
          return false
        }
      } else {
        logger.info('Using explicitly provided OIDC endpoints (all present)', {
          authorizationEndpoint: ssoConfig.oidcConfig.authorizationEndpoint,
          tokenEndpoint: ssoConfig.oidcConfig.tokenEndpoint,
          userInfoEndpoint: ssoConfig.oidcConfig.userInfoEndpoint,
          jwksEndpoint: ssoConfig.oidcConfig.jwksEndpoint,
        })
      }

      if (ssoConfig.oidcConfig.skipUserInfoEndpoint) {
        ssoConfig.oidcConfig.userInfoEndpoint = undefined
        logger.info('Skipping UserInfo endpoint: claims will be read from the verified ID token')
      }

      if (
        !ssoConfig.oidcConfig.authorizationEndpoint ||
        !ssoConfig.oidcConfig.tokenEndpoint ||
        !ssoConfig.oidcConfig.jwksEndpoint
      ) {
        const missing: string[] = []
        if (!ssoConfig.oidcConfig.authorizationEndpoint)
          missing.push('SSO_OIDC_AUTHORIZATION_ENDPOINT')
        if (!ssoConfig.oidcConfig.tokenEndpoint) missing.push('SSO_OIDC_TOKEN_ENDPOINT')
        if (!ssoConfig.oidcConfig.jwksEndpoint) missing.push('SSO_OIDC_JWKS_ENDPOINT')

        logger.error('Missing required OIDC endpoints after discovery merge', {
          missing,
          authorizationEndpoint: ssoConfig.oidcConfig.authorizationEndpoint,
          tokenEndpoint: ssoConfig.oidcConfig.tokenEndpoint,
          jwksEndpoint: ssoConfig.oidcConfig.jwksEndpoint,
        })
        logger.error(`Please provide: ${missing.join(', ')}`)
        return false
      }
    }

    const allProviders = await db.select().from(ssoProvider)
    const existingProviders = allProviders.filter(
      (provider) => provider.providerId === ssoConfig.providerId
    )
    const existingProvider = existingProviders[0]
    if (existingProvider) {
      logger.error(
        'The provider ID already exists. Direct script updates are intentionally unsupported; use the guarded Settings API.'
      )
      return false
    }
    if (
      allProviders.some(
        (provider) =>
          provider.id !== existingProvider?.id &&
          (provider.organizationId === organizationId ||
            domainsOverlap(provider.domain, ssoConfig.domain))
      )
    ) {
      logger.error(
        'The organization already has a provider or its domain overlaps another provider'
      )
      return false
    }

    const providerData: SSOProviderData = {
      id: generateId(),
      issuer: ssoConfig.issuer,
      domain: ssoConfig.domain,
      userId: adminUser.id,
      providerId: ssoConfig.providerId,
      organizationId,
      domainVerified: false,
    }

    if (ssoConfig.providerType === 'oidc' && ssoConfig.oidcConfig) {
      const oidcConfig = {
        issuer: ssoConfig.issuer,
        clientId: ssoConfig.oidcConfig.clientId,
        clientSecret: ssoConfig.oidcConfig.clientSecret,
        authorizationEndpoint: ssoConfig.oidcConfig.authorizationEndpoint,
        tokenEndpoint: ssoConfig.oidcConfig.tokenEndpoint,
        // Default to client_secret_post: better-auth sends client_secret_basic
        // credentials without URL-encoding per RFC 6749 §2.3.1, so '+' in secrets
        // is decoded as space by OIDC providers, causing invalid_client errors.
        tokenEndpointAuthentication:
          ssoConfig.oidcConfig.tokenEndpointAuthentication ?? 'client_secret_post',
        jwksEndpoint: ssoConfig.oidcConfig.jwksEndpoint,
        pkce: ssoConfig.oidcConfig.pkce,
        discoveryEndpoint:
          ssoConfig.oidcConfig.discoveryEndpoint ||
          `${ssoConfig.issuer}/.well-known/openid-configuration`,
        mapping: ssoConfig.mapping,
        scopes: ssoConfig.oidcConfig.scopes,
        userInfoEndpoint: ssoConfig.oidcConfig.userInfoEndpoint,
        overrideUserInfo: false,
      }
      providerData.oidcConfig = JSON.stringify(oidcConfig)
    }

    if (ssoConfig.providerType === 'saml' && ssoConfig.samlConfig) {
      const samlConfig = {
        issuer: ssoConfig.issuer,
        entryPoint: ssoConfig.samlConfig.entryPoint,
        cert: ssoConfig.samlConfig.cert,
        callbackUrl: ssoConfig.samlConfig.callbackUrl,
        audience: ssoConfig.samlConfig.audience,
        idpMetadata: ssoConfig.samlConfig.idpMetadata,
        spMetadata: ssoConfig.samlConfig.spMetadata,
        wantAssertionsSigned: ssoConfig.samlConfig.wantAssertionsSigned,
        signatureAlgorithm: ssoConfig.samlConfig.signatureAlgorithm,
        digestAlgorithm: ssoConfig.samlConfig.digestAlgorithm,
        identifierFormat: ssoConfig.samlConfig.identifierFormat,
        privateKey: ssoConfig.samlConfig.privateKey,
        decryptionPvk: ssoConfig.samlConfig.decryptionPvk,
        additionalParams: ssoConfig.samlConfig.additionalParams,
        mapping: ssoConfig.mapping,
      }
      providerData.samlConfig = JSON.stringify(samlConfig)
    }

    await db.insert(ssoProvider).values(providerData)

    logger.info('✅ SSO provider registered successfully in database!', {
      providerId: ssoConfig.providerId,
      providerType: ssoConfig.providerType,
      domain: ssoConfig.domain,
      id: providerData.id,
    })

    if (process.env.SSO_DOMAIN_VERIFICATION_ENABLED === 'true') {
      logger.info('🔐 Provider created pending DNS domain verification in the Settings UI')
    } else {
      logger.info(
        '🔗 Users can now sign in using SSO (domain verification enforcement is disabled)'
      )
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || 'https://your-domain.com'
    const callbackPath =
      ssoConfig.providerType === 'saml'
        ? `api/auth/sso/saml2/callback/${ssoConfig.providerId}`
        : `api/auth/sso/callback/${ssoConfig.providerId}`
    logger.info(
      `📋 Callback URL (configure this in your identity provider): ${baseUrl}/${callbackPath}`
    )

    return true
  } catch (error) {
    logger.error('❌ Failed to register SSO provider:', {
      error: getErrorMessage(error, 'Unknown error'),
      errorType: typeof error,
      errorDetails: JSON.stringify(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return false
  } finally {
    try {
      await postgresClient.end({ timeout: 5 })
    } catch {}
  }
}

async function main() {
  console.log('🔐 Audited Direct Database SSO Registration Script')
  console.log('====================================================================')
  console.log('This script directly inserts SSO provider records into the database.')
  console.log('It enforces the same organization and identity invariants as Sim management APIs.\n')

  const success = await registerSSOProvider()

  if (success) {
    console.log('🎉 SSO setup completed successfully!')
    console.log()
    console.log('Next steps:')
    console.log('1. Configure the callback URL in your identity provider')
    console.log('2. Restart your application if needed')
    console.log('3. Users can now sign in with SSO!')
    process.exit(0)
  } else {
    console.log('💥 SSO setup failed. Check the logs above for details.')
    process.exit(1)
  }
}

main().catch((error) => {
  logger.error('Script execution failed:', { error })
  process.exit(1)
})
