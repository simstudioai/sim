import type { OIDCConfig, SAMLConfig, SAMLIdentityProviderMetadata } from '@better-auth/sso'
import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { configuredSsoPlugin } from '@/lib/auth/sso/plugin'
import { isSsoEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/** The plugin's input schemas take one certificate or a non-empty list. */
type SigningCertificate = string | [string, ...string[]]

/** IdP authority: a metadata document, or a declared entity ID for a manual configuration. */
type SamlIdentityProviderInput = Omit<
  SAMLIdentityProviderMetadata,
  'cert' | 'metadata' | 'entityID'
> & {
  cert?: SigningCertificate
} & ({ metadata: string; entityID?: string } | { metadata?: undefined; entityID: string })

/**
 * Registration input accepted by the configured Better Auth SSO plugin. Written out because the
 * plugin declares its registration body as an untyped record; the runtime schema still validates it.
 */
export interface SsoProviderConfig {
  providerId: string
  issuer: string
  domain: string
  organizationId?: string
  overrideUserInfo?: boolean
  oidcConfig?: Omit<OIDCConfig, 'issuer' | 'pkce' | 'discoveryEndpoint' | 'allowIdpInitiated'> & {
    pkce?: boolean
    discoveryEndpoint?: string
    skipDiscovery?: boolean
  }
  samlConfig?: Omit<SAMLConfig, 'issuer' | 'cert' | 'idpMetadata'> & {
    cert?: SigningCertificate
    idpMetadata: SamlIdentityProviderInput
  }
}

/** Creates a common writer after the application operation has authorized the acting user. */
export async function ssoProviderWriter(
  principal: Principal,
  organizationId: string,
  executor: DbOrTx = db
) {
  if (
    principal.kind !== 'session' &&
    principal.kind !== 'personal_api_key' &&
    principal.kind !== 'oauth_access_token'
  )
    throw new OrchestrationError('forbidden', 'SSO provider writes require a user credential')
  if (!isSsoEnabled) throw new OrchestrationError('validation', 'SSO is not enabled')
  const userId = requirePrincipalSubjectUserId(principal)
  const { auth } = await import('@/lib/auth')
  const context = await auth.$context
  const { createSsoProviderRepository } = await import('@/lib/auth/sso/provider-repository')
  return createSsoProviderRepository(
    userId,
    organizationId,
    configuredSsoPlugin,
    {
      reservedProviderIds: [
        ...Object.keys(context.options.socialProviders ?? {}),
        ...context.socialProviders.map((provider) => provider.id),
        ...context.trustedProviders,
      ],
    },
    executor
  )
}
