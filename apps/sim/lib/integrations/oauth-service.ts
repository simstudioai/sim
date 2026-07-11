import type { ComponentType } from 'react'
import integrationsJson from '@/lib/integrations/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { getServiceConfigByServiceId } from '@/lib/oauth'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import type { ServiceAccountProviderId } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal'

const INTEGRATIONS_DATA: readonly Integration[] =
  integrationsJson.integrations as readonly Integration[]

/**
 * Shape returned from resolving an integration to its OAuth service entry in
 * `OAUTH_PROVIDERS`. Carries the metadata needed to mount `ConnectOAuthModal`
 * (and optionally `ConnectServiceAccountModal`) for the integration.
 */
export interface OAuthServiceMatch {
  providerId: string
  requiredScopes: string[]
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /**
   * When set, the matched OAuth service also exposes a service-account flow
   * (e.g. Google services with `google-service-account`, Atlassian services
   * with `atlassian-service-account`). Callers may surface this as a secondary
   * connect option.
   */
  serviceAccountProviderId?: ServiceAccountProviderId
}

/**
 * Narrows the runtime `OAuthServiceConfig.serviceAccountProviderId` string to
 * the {@link ServiceAccountProviderId} union. Anything outside the union is
 * unsupported by `ConnectServiceAccountModal` and is silently ignored.
 */
function asServiceAccountProviderId(
  value: string | undefined
): ServiceAccountProviderId | undefined {
  if (
    value === 'google-service-account' ||
    value === 'atlassian-service-account' ||
    value === SLACK_CUSTOM_BOT_PROVIDER_ID
  ) {
    return value
  }
  return undefined
}

/**
 * Looks up the OAuth service entry registered under the integration's
 * `oauthServiceId` — the service id its block declares on the `oauth-input`
 * subBlock, carried into the catalog at generation time. Returns `null` for
 * non-OAuth integrations or when no matching service is registered in
 * `OAUTH_PROVIDERS`.
 */
export function resolveOAuthServiceForIntegration(
  integration: Integration
): OAuthServiceMatch | null {
  if (integration.authType !== 'oauth' || !integration.oauthServiceId) return null
  const service = getServiceConfigByServiceId(integration.oauthServiceId)
  if (!service) return null
  return {
    providerId: service.providerId,
    requiredScopes: service.scopes ?? [],
    serviceName: service.name,
    serviceIcon: service.icon as ComponentType<{ className?: string }>,
    serviceAccountProviderId: asServiceAccountProviderId(service.serviceAccountProviderId),
  }
}

/**
 * Resolves the integration entry for a catalog slug, then derives its OAuth
 * service match. Returns `null` when the slug is unknown or the matching
 * integration is not an OAuth integration.
 */
export function resolveOAuthServiceForSlug(slug: string): OAuthServiceMatch | null {
  const integration = INTEGRATIONS_DATA.find((entry) => entry.slug === slug)
  if (!integration) return null
  return resolveOAuthServiceForIntegration(integration)
}
