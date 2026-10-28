import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { SsoProviderView } from '@/lib/api/contracts/auth'
import type { V2SsoProvider } from '@/lib/api/contracts/v2/sso'
import type { SsoProviderSettings } from '@/lib/auth/sso/application/provider-settings'
import { REDACTED_MARKER } from '@/lib/core/security/redaction'

const OIDC_FIELDS = [
  'issuer',
  'clientId',
  'scopes',
  'pkce',
  'authorizationEndpoint',
  'tokenEndpoint',
  'userInfoEndpoint',
  'jwksEndpoint',
  'tokenEndpointAuthentication',
  'mapping',
  'skipDiscovery',
  'discoveryEndpoint',
  'overrideUserInfo',
] as const
const SAML_FIELDS = [
  'issuer',
  'entryPoint',
  'cert',
  'callbackUrl',
  'spMetadata',
  'idpMetadata',
  'audience',
  'wantAssertionsSigned',
  'signatureAlgorithm',
  'digestAlgorithm',
  'identifierFormat',
  'mapping',
] as const

function publicConfig(
  value: string | null,
  fields: readonly string[],
  oidc: boolean
): string | null {
  if (!value) return null
  try {
    const record = toRecord(JSON.parse(value))
    const projected: Record<string, unknown> = {}
    for (const key of fields) {
      if (record[key] === undefined) continue
      if (key === 'spMetadata' || key === 'idpMetadata') {
        const metadata: Record<string, unknown> =
          typeof record[key] === 'string' ? { metadata: record[key] } : toRecord(record[key])
        projected[key] = {
          metadata: metadata.metadata,
          entityID: metadata.entityID,
          cert: metadata.cert,
          binding: metadata.binding,
          singleSignOnService: metadata.singleSignOnService,
          isAssertionEncrypted: metadata.isAssertionEncrypted,
        }
      } else projected[key] = record[key]
    }
    if (oidc) projected.clientSecret = REDACTED_MARKER
    return JSON.stringify(projected)
  } catch {
    return null
  }
}

/** Projects provider settings without stored OIDC secrets or SAML private keys. */
export function presentSsoProvider(provider: SsoProviderSettings): V2SsoProvider {
  return {
    id: provider.id,
    providerId: provider.providerId,
    providerType: provider.samlConfig ? 'saml' : 'oidc',
    domain: provider.domain,
    domainKey: provider.domainKey,
    issuer: provider.issuer,
    domainVerified: provider.domainVerified,
    isPrimary: provider.isPrimary,
    jitProvisioningEnabled: provider.jitProvisioningEnabled,
    oidcConfig: publicConfig(provider.oidcConfig, OIDC_FIELDS, true),
    samlConfig: publicConfig(provider.samlConfig, SAML_FIELDS, false),
  }
}

/** Keeps the settings UI's masked secret hint for sufficiently long client secrets. */
export function presentSsoProviderSettings(provider: SsoProviderSettings): SsoProviderView {
  const result = presentSsoProvider(provider)
  if (provider.oidcConfig && result.oidcConfig) {
    try {
      const secret = toStringOrNull(toRecord(JSON.parse(provider.oidcConfig)).clientSecret)
      if (secret && secret.length >= 16)
        result.oidcConfig = JSON.stringify({
          ...toRecord(JSON.parse(result.oidcConfig)),
          clientSecretHint: secret.slice(-4),
        })
    } catch {}
  }
  return { ...result, userId: provider.userId, organizationId: provider.organizationId }
}
