import type { ComponentType } from 'react'
import { asServiceAccountProviderId } from '@/lib/credentials/service-account-provider-ids'
import integrationsJson from '@/lib/integrations/integrations.json'
import type { Integration } from '@/lib/integrations/types'
import { getServiceConfigByServiceId } from '@/lib/oauth'
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

/**
 * An integration that exposes a service-account connect flow, resolved to the
 * catalog slug whose detail page mounts `ConnectServiceAccountModal`.
 */
export interface ServiceAccountIntegrationMatch {
  slug: string
  serviceAccountProviderId: ServiceAccountProviderId
  serviceName: string
  providerId: string
}

/**
 * Slug to prefer for a query that names a family rather than one of its
 * integrations — either the shared service-account provider id or the bare
 * base provider. Every Google integration issues the same
 * `google-service-account` credential and every Atlassian one the same
 * `atlassian-service-account`, so an unqualified request has to land
 * somewhere; these are the most general surface of each family.
 *
 * Without the bare-provider entries, fuzzy matching resolves `google` to
 * whichever Google integration sorts first in the catalog (BigQuery), which is
 * both arbitrary and a poor landing page. A caller that names a specific
 * integration still gets that integration.
 */
const CANONICAL_SERVICE_ACCOUNT_SLUGS: Readonly<Record<string, string>> = {
  'google-service-account': 'google-drive',
  google: 'google-drive',
  'atlassian-service-account': 'jira',
  atlassian: 'jira',
} as const

/**
 * Every integration that offers a service-account flow, in catalog order.
 * Built once — `resolveOAuthServiceForIntegration` walks `OAUTH_PROVIDERS` per
 * entry, which is wasted work to repeat on each lookup.
 */
const SERVICE_ACCOUNT_INTEGRATIONS: readonly ServiceAccountIntegrationMatch[] =
  INTEGRATIONS_DATA.flatMap((integration) => {
    const match = resolveOAuthServiceForIntegration(integration)
    if (!match?.serviceAccountProviderId) return []
    return [
      {
        slug: integration.slug,
        serviceAccountProviderId: match.serviceAccountProviderId,
        serviceName: integration.name,
        providerId: match.providerId,
      },
    ]
  })

/**
 * Resolves a loosely-specified integration name to the service-account setup
 * surface for it. Accepts a catalog slug (`google-sheets`), an OAuth provider
 * value (`google-email`), a service-account provider id
 * (`google-service-account`), or a display name (`Google Sheets`).
 *
 * Exact matches are tried before fuzzy ones so a caller naming a specific
 * integration always lands on it: `gmail` must not fall through to Drive just
 * because both issue the same Google service account. A bare service-account
 * provider id names no single integration, so it resolves through
 * {@link CANONICAL_SERVICE_ACCOUNT_SLUGS}.
 *
 * Returns `null` when nothing matches or the named integration has no
 * service-account flow — callers should fall back to OAuth rather than
 * inventing a link.
 */
export function resolveServiceAccountIntegration(
  providerName: string
): ServiceAccountIntegrationMatch | null {
  const query = providerName.toLowerCase().trim()
  if (!query) return null

  const canonicalSlug = CANONICAL_SERVICE_ACCOUNT_SLUGS[query]
  if (canonicalSlug) {
    const canonical = SERVICE_ACCOUNT_INTEGRATIONS.find((entry) => entry.slug === canonicalSlug)
    if (canonical) return canonical
  }

  return (
    SERVICE_ACCOUNT_INTEGRATIONS.find((entry) => entry.slug === query) ??
    SERVICE_ACCOUNT_INTEGRATIONS.find((entry) => entry.providerId.toLowerCase() === query) ??
    SERVICE_ACCOUNT_INTEGRATIONS.find(
      (entry) => entry.serviceAccountProviderId.toLowerCase() === query
    ) ??
    SERVICE_ACCOUNT_INTEGRATIONS.find((entry) => entry.serviceName.toLowerCase() === query) ??
    SERVICE_ACCOUNT_INTEGRATIONS.find(
      (entry) =>
        entry.serviceName.toLowerCase().includes(query) || entry.slug.replace(/-/g, ' ') === query
    ) ??
    null
  )
}
