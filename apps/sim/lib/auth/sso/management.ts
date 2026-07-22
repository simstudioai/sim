import { account, db, member, ssoProvider } from '@sim/db'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import type { SsoRegistrationData, SsoUpdateData } from '@/lib/api/contracts/auth'
import { SSO_RESERVED_PROVIDER_IDS } from '@/lib/auth/sso/config'
import { normalizeSSODomain } from '@/lib/auth/sso/domain'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'
import { getBaseUrl } from '@/lib/core/utils/urls'

const DNS_LABEL_MAX_LENGTH = 63
const DOMAIN_VERIFICATION_TOKEN_PREFIX = 'better-auth-token'
const DOMAIN_VERIFICATION_RECORD_PREFIX = `_${DOMAIN_VERIFICATION_TOKEN_PREFIX}-`
export const SSO_PROVIDER_ID_MAX_LENGTH =
  DNS_LABEL_MAX_LENGTH - DOMAIN_VERIFICATION_RECORD_PREFIX.length

const OIDC_DISCOVERY_TIMEOUT_MS = 10_000

type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post'

export interface SSOProviderRecord {
  id: string
  issuer: string
  domain: string
  domainVerified: boolean
  oidcConfig: string | null
  samlConfig: string | null
  userId: string
  providerId: string
  organizationId: string | null
}

export class SSOManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'SSOManagementError'
  }
}

export function collectAuthHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

export function getDomainVerificationRecordName(providerId: string, domain: string): string {
  return `${DOMAIN_VERIFICATION_RECORD_PREFIX}${providerId}.${domain}`
}

export function getDomainVerificationRecordValue(providerId: string, token: string): string {
  return `${DOMAIN_VERIFICATION_RECORD_PREFIX}${providerId}=${token}`
}

export function validateSSOProviderId(providerId: string): void {
  if (SSO_RESERVED_PROVIDER_IDS.some((reservedId) => reservedId === providerId)) {
    throw new SSOManagementError(
      'Provider ID is reserved by a built-in authentication provider',
      400,
      'SSO_PROVIDER_ID_RESERVED'
    )
  }
  if (
    providerId.length > SSO_PROVIDER_ID_MAX_LENGTH ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(providerId)
  ) {
    throw new SSOManagementError(
      `Provider ID must be a lowercase DNS label no longer than ${SSO_PROVIDER_ID_MAX_LENGTH} characters`,
      400,
      'SSO_PROVIDER_ID_INVALID'
    )
  }
}

export function requireNormalizedSSODomain(input: string, existingDomain?: string): string {
  const domain = normalizeSSODomain(input)
  if (domain) return domain

  const normalizedInput = input.trim().toLowerCase().replace(/\.$/, '')
  if (
    existingDomain &&
    normalizedInput === existingDomain.trim().toLowerCase().replace(/\.$/, '')
  ) {
    return existingDomain
  }

  throw new SSOManagementError(
    'Enter one registrable domain like company.com',
    400,
    'SSO_DOMAIN_INVALID'
  )
}

export function domainsOverlap(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)
}

export async function authorizeOrganizationSSOAdmin(
  userId: string,
  organizationId: string
): Promise<void> {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1)

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    throw new SSOManagementError('Forbidden', 403, 'SSO_FORBIDDEN')
  }
}

export async function authorizeOrganizationSSO(
  userId: string,
  organizationId: string
): Promise<void> {
  await authorizeOrganizationSSOAdmin(userId, organizationId)
  if (!(await isOrganizationOnEnterprisePlan(organizationId))) {
    throw new SSOManagementError('SSO requires an Enterprise plan', 403, 'SSO_ENTERPRISE_REQUIRED')
  }
}

export async function getManagedSSOProvider(
  rowId: string,
  userId: string,
  options: { requireCreator?: boolean } = {}
): Promise<SSOProviderRecord> {
  const [provider] = await db
    .select({
      id: ssoProvider.id,
      issuer: ssoProvider.issuer,
      domain: ssoProvider.domain,
      domainVerified: ssoProvider.domainVerified,
      oidcConfig: ssoProvider.oidcConfig,
      samlConfig: ssoProvider.samlConfig,
      userId: ssoProvider.userId,
      providerId: ssoProvider.providerId,
      organizationId: ssoProvider.organizationId,
    })
    .from(ssoProvider)
    .where(eq(ssoProvider.id, rowId))
    .limit(1)

  if (!provider?.organizationId) {
    throw new SSOManagementError('SSO provider not found', 404, 'SSO_PROVIDER_NOT_FOUND')
  }

  await authorizeOrganizationSSO(userId, provider.organizationId)

  if (options.requireCreator && provider.userId !== userId) {
    throw new SSOManagementError(
      'Only the administrator who created this provider can verify its domain',
      403,
      'SSO_CREATOR_REQUIRED'
    )
  }

  return provider
}

export async function assertSSOProviderHasNoAccountLinks(providerId: string): Promise<void> {
  const [linkedAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(eq(account.providerId, providerId))
    .limit(1)
  if (linkedAccount) {
    throw new SSOManagementError(
      'This provider has linked user accounts. Complete the account-link and session migration before changing its identity or deleting it.',
      409,
      'SSO_PROVIDER_HAS_LINKED_ACCOUNTS'
    )
  }
}

export async function assertSSOProviderAvailable(input: {
  providerId: string
  domain: string
  organizationId: string
  excludeRowId?: string
}): Promise<void> {
  const providers = await db
    .select({
      id: ssoProvider.id,
      providerId: ssoProvider.providerId,
      domain: ssoProvider.domain,
      organizationId: ssoProvider.organizationId,
    })
    .from(ssoProvider)

  for (const provider of providers) {
    if (provider.id === input.excludeRowId) continue
    if (provider.providerId === input.providerId) {
      throw new SSOManagementError(
        'This provider ID is already in use',
        409,
        'SSO_PROVIDER_ID_CONFLICT'
      )
    }
    if (provider.organizationId === input.organizationId) {
      throw new SSOManagementError(
        'This organization already has an SSO provider',
        409,
        'SSO_ORGANIZATION_PROVIDER_CONFLICT'
      )
    }
    if (domainsOverlap(provider.domain.toLowerCase(), input.domain)) {
      throw new SSOManagementError(
        'This domain overlaps an SSO domain registered by another organization',
        409,
        'SSO_DOMAIN_ALREADY_REGISTERED'
      )
    }
  }
}

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

async function fetchOIDCDiscoveryDocument(
  discoveryUrl: string
): Promise<{ ok: true; discovery: Record<string, unknown> } | { ok: false; error: string }> {
  const validation = await validateUrlWithDNS(discoveryUrl, 'OIDC discovery URL')
  if (!validation.isValid || !validation.resolvedIP) {
    return { ok: false, error: validation.error ?? 'SSRF validation failed' }
  }

  try {
    const response = await secureFetchWithPinnedIP(discoveryUrl, validation.resolvedIP, {
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

interface OIDCConfig {
  clientId: string
  clientSecret: string
  scopes: string[]
  pkce: boolean
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userInfoEndpoint?: string
  jwksEndpoint?: string
  tokenEndpointAuthentication?: TokenEndpointAuthMethod
  skipDiscovery: true
  mapping: SsoRegistrationData['mapping']
}

async function buildOIDCConfig(
  body: Extract<SsoRegistrationData, { providerType: 'oidc' }> | SsoUpdateData,
  existingConfig?: string | null
): Promise<OIDCConfig> {
  if (!('clientId' in body)) {
    throw new SSOManagementError('OIDC configuration is required', 400)
  }

  let clientSecret = body.clientSecret
  if (clientSecret === REDACTED_MARKER) {
    if (!existingConfig) {
      throw new SSOManagementError('Re-enter the client secret', 400)
    }
    try {
      const parsed = JSON.parse(existingConfig) as { clientSecret?: string }
      if (!parsed.clientSecret) throw new Error('Missing client secret')
      clientSecret = parsed.clientSecret
    } catch {
      throw new SSOManagementError('Re-enter the client secret', 400)
    }
  }

  const config: OIDCConfig = {
    clientId: body.clientId,
    clientSecret,
    scopes: body.scopes.filter((scope) => scope !== 'offline_access'),
    pkce: body.pkce,
    mapping: body.mapping,
    authorizationEndpoint: body.authorizationEndpoint,
    tokenEndpoint: body.tokenEndpoint,
    userInfoEndpoint: body.skipUserInfoEndpoint ? undefined : body.userInfoEndpoint,
    jwksEndpoint: body.jwksEndpoint,
    skipDiscovery: true,
  }

  const explicitEndpoints = {
    authorizationEndpoint: config.authorizationEndpoint,
    tokenEndpoint: config.tokenEndpoint,
    jwksEndpoint: config.jwksEndpoint,
    ...(body.skipUserInfoEndpoint ? {} : { userInfoEndpoint: config.userInfoEndpoint }),
  }
  for (const [name, endpoint] of Object.entries(explicitEndpoints)) {
    if (!endpoint) continue
    const validation = await validateUrlWithDNS(endpoint, `OIDC ${name}`)
    if (!validation.isValid) {
      throw new SSOManagementError(
        `OIDC ${name} failed security validation: ${validation.error}`,
        400
      )
    }
  }

  const needsDiscovery =
    !config.authorizationEndpoint || !config.tokenEndpoint || !config.jwksEndpoint
  const discoveryUrl = `${body.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const discoveryResult = await fetchOIDCDiscoveryDocument(discoveryUrl)
  if (needsDiscovery && !discoveryResult.ok) {
    throw new SSOManagementError(
      `Failed to fetch OIDC discovery document: ${discoveryResult.error}. Provide all endpoints explicitly or verify the issuer URL.`,
      400
    )
  }

  if (discoveryResult.ok) {
    const discovery = discoveryResult.discovery
    const discoveredEndpoints = {
      ...(!config.authorizationEndpoint
        ? { authorizationEndpoint: discovery.authorization_endpoint }
        : {}),
      ...(!config.tokenEndpoint ? { tokenEndpoint: discovery.token_endpoint } : {}),
      ...(!config.jwksEndpoint ? { jwksEndpoint: discovery.jwks_uri } : {}),
      ...(!body.skipUserInfoEndpoint && !config.userInfoEndpoint
        ? { userInfoEndpoint: discovery.userinfo_endpoint }
        : {}),
    }
    for (const [name, endpoint] of Object.entries(discoveredEndpoints)) {
      if (typeof endpoint !== 'string') continue
      const validation = await validateUrlWithDNS(endpoint, `OIDC ${name}`)
      if (!validation.isValid) {
        throw new SSOManagementError(
          `Discovered OIDC ${name} failed security validation: ${validation.error}`,
          400
        )
      }
    }

    config.authorizationEndpoint ||=
      typeof discovery.authorization_endpoint === 'string'
        ? discovery.authorization_endpoint
        : undefined
    config.tokenEndpoint ||=
      typeof discovery.token_endpoint === 'string' ? discovery.token_endpoint : undefined
    config.jwksEndpoint ||= typeof discovery.jwks_uri === 'string' ? discovery.jwks_uri : undefined
    if (!body.skipUserInfoEndpoint) {
      config.userInfoEndpoint ||=
        typeof discovery.userinfo_endpoint === 'string' ? discovery.userinfo_endpoint : undefined
    }
    config.tokenEndpointAuthentication = selectTokenEndpointAuthMethod(
      discovery.token_endpoint_auth_methods_supported
    )
  } else {
    config.tokenEndpointAuthentication = selectTokenEndpointAuthMethod(undefined)
  }

  const missing = [
    !config.authorizationEndpoint ? 'authorizationEndpoint' : null,
    !config.tokenEndpoint ? 'tokenEndpoint' : null,
    !config.jwksEndpoint ? 'jwksEndpoint' : null,
  ].filter((value): value is string => Boolean(value))
  if (missing.length > 0) {
    throw new SSOManagementError(`Missing required OIDC endpoints: ${missing.join(', ')}`, 400)
  }

  return config
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    }
    return entities[character]
  })
}

interface SAMLConfig {
  entryPoint: string
  cert: string
  callbackUrl: string
  audience?: string
  wantAssertionsSigned?: boolean
  signatureAlgorithm?: string
  digestAlgorithm?: string
  identifierFormat?: string
  mapping: SsoRegistrationData['mapping']
  spMetadata: { metadata: string }
  idpMetadata: { metadata: string }
}

function certificateBody(certificate: string): string {
  return certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '')
}

function buildGeneratedIdpMetadata(
  issuer: string,
  entryPoint: string,
  certificate: string
): string {
  return `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(issuer)}">
  <IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${certificateBody(certificate)}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(entryPoint)}"/>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(entryPoint)}"/>
  </IDPSSODescriptor>
</EntityDescriptor>`
}

function buildSAMLConfig(
  body: Extract<SsoRegistrationData, { providerType: 'saml' }> | SsoUpdateData,
  providerId: string,
  existingConfig?: string | null,
  existingIssuer?: string
): SAMLConfig {
  if (!('entryPoint' in body)) {
    throw new SSOManagementError('SAML configuration is required', 400)
  }

  const baseUrl = getBaseUrl()
  const callbackUrl = body.callbackUrl || `${baseUrl}/api/auth/sso/saml2/callback/${providerId}`
  if (body.callbackUrl && new URL(callbackUrl).origin !== new URL(baseUrl).origin) {
    throw new SSOManagementError(
      'SAML callback URL must use the application origin',
      400,
      'SSO_CALLBACK_URL_INVALID'
    )
  }
  const entityId = baseUrl
  const spMetadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="${body.wantAssertionsSigned ?? false}" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(callbackUrl)}" index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`
  let suppliedIdpMetadata = body.idpMetadata
  if (suppliedIdpMetadata && existingConfig && existingIssuer) {
    try {
      const existing = JSON.parse(existingConfig) as {
        entryPoint?: string
        cert?: string
        idpMetadata?: { metadata?: string } | string
      }
      const existingMetadata =
        typeof existing.idpMetadata === 'string'
          ? existing.idpMetadata
          : existing.idpMetadata?.metadata
      const generatedExistingMetadata =
        existing.entryPoint && existing.cert
          ? buildGeneratedIdpMetadata(existingIssuer, existing.entryPoint, existing.cert)
          : undefined
      if (
        suppliedIdpMetadata === existingMetadata &&
        existingMetadata === generatedExistingMetadata
      ) {
        suppliedIdpMetadata = undefined
      }
    } catch {
      throw new SSOManagementError('Stored SAML configuration is invalid', 500)
    }
  }
  const idpMetadata =
    suppliedIdpMetadata || buildGeneratedIdpMetadata(body.issuer, body.entryPoint, body.cert)

  return {
    entryPoint: body.entryPoint,
    cert: body.cert,
    callbackUrl,
    audience: body.audience,
    wantAssertionsSigned: body.wantAssertionsSigned,
    signatureAlgorithm: body.signatureAlgorithm,
    digestAlgorithm: body.digestAlgorithm,
    identifierFormat: body.identifierFormat,
    mapping: body.mapping,
    spMetadata: { metadata: spMetadata },
    idpMetadata: { metadata: idpMetadata },
  }
}

export async function buildSSOProviderConfiguration(
  body: SsoRegistrationData | SsoUpdateData,
  input: {
    providerId: string
    organizationId?: string
    existingConfig?: string | null
    existingIssuer?: string
    existingDomain?: string
  }
) {
  const domain = requireNormalizedSSODomain(body.domain, input.existingDomain)
  const common = {
    providerId: input.providerId,
    issuer: body.issuer,
    domain,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
  }

  if ('entryPoint' in body) {
    return {
      ...common,
      samlConfig: buildSAMLConfig(
        body,
        input.providerId,
        input.existingConfig,
        input.existingIssuer
      ),
    }
  }

  return {
    ...common,
    oidcConfig: await buildOIDCConfig(body, input.existingConfig),
  }
}

export function ssoManagementErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SSOManagementError) {
    return NextResponse.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status }
    )
  }
  if (getPostgresErrorCode(error) === '23505') {
    return NextResponse.json(
      {
        error: 'The provider ID, domain, or organization already has an SSO provider',
        code: 'SSO_CONFLICT',
      },
      { status: 409 }
    )
  }
  if (error instanceof APIError) {
    const code =
      typeof error.body === 'object' &&
      error.body !== null &&
      'code' in error.body &&
      typeof error.body.code === 'string'
        ? error.body.code
        : undefined
    return NextResponse.json(
      { error: error.message, ...(code ? { code } : {}) },
      { status: error.statusCode }
    )
  }
  return null
}
