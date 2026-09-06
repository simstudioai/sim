/**
 * Single source of truth for how a stored credential is presented: which
 * catalog integrations it powers, which mark and brand tile represent it, and
 * the sentence describing it.
 *
 * Replaces a display-name-keyed catalog lookup that three surfaces each
 * re-derived. That keying silently failed for family service accounts:
 * `atlassian-service-account` resolves to a pseudo-service named "Atlassian
 * Service Account", which matches no catalog entry, so the credential lost its
 * brand tile and its category filter.
 */

import type { ComponentType } from 'react'
import { getIntegrationTypesForOAuthServiceId } from '@sim/deployment-config/integration-availability'
import integrationsJson from '@sim/deployment-config/integrations.json'
import { GitlabIcon } from '@/components/icons'
import { getServiceAccountConnectNoun } from '@/lib/credentials/service-account-provider-ids'
import { CANONICAL_SERVICE_ACCOUNT_SLUGS } from '@/lib/integrations/oauth-service'
import type { Integration } from '@/lib/integrations/types'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import type { OAuthProvider, OAuthServiceConfig } from '@/lib/oauth/types'
import { getServiceConfigByProviderId, parseProvider } from '@/lib/oauth/utils'

const INTEGRATIONS_DATA: readonly Integration[] =
  integrationsJson.integrations as readonly Integration[]

/**
 * Above this many covered integrations the subtitle states a count instead of
 * enumerating names — Google issues one service account for 13 integrations,
 * which does not fit on a list row.
 */
const MAX_ENUMERATED_INTEGRATIONS = 3

/**
 * Catalog indexes built once at module load. `resolveCredentialDisplay` runs
 * inline per credential per render on the integrations surfaces, so its lookups
 * must be O(1) rather than scanning the full catalog each time.
 */
const INTEGRATION_BY_SLUG: ReadonlyMap<string, Integration> = new Map(
  INTEGRATIONS_DATA.map((i) => [i.slug, i])
)
const INTEGRATION_BY_TYPE: ReadonlyMap<string, Integration> = new Map(
  INTEGRATIONS_DATA.map((integration) => [integration.type, integration])
)

/** Keyed by lowercased display name, matching how OAuth services are named. */
const INTEGRATION_BY_LOWER_NAME: ReadonlyMap<string, Integration> = new Map(
  INTEGRATIONS_DATA.map((i) => [i.name.toLowerCase(), i])
)

/** Every provider id that some service designates as its service-account id. */
const SERVICE_ACCOUNT_PROVIDER_IDS: ReadonlySet<string> = new Set(
  Object.values(OAUTH_PROVIDERS).flatMap((provider) =>
    Object.values(provider.services).flatMap((service) =>
      service.serviceAccountProviderId ? [service.serviceAccountProviderId] : []
    )
  )
)

/**
 * `credentialProviderId` → catalog integrations it authenticates, in catalog
 * order. Built once at module load: resolving a service per integration walks
 * `OAUTH_PROVIDERS`, which is wasted work to repeat per lookup (same reasoning
 * as `SERVICE_ACCOUNT_INTEGRATIONS` in `oauth-service.ts`).
 *
 * The deployment service mapping also covers Search-only OAuth credentials
 * whose corresponding workflow integration uses an API key.
 */
const INTEGRATIONS_BY_CREDENTIAL_PROVIDER: ReadonlyMap<string, readonly Integration[]> = (() => {
  const index = new Map<string, Integration[]>()
  const add = (providerId: string | undefined, integration: Integration) => {
    if (!providerId) return
    const existing = index.get(providerId)
    if (existing) existing.push(integration)
    else index.set(providerId, [integration])
  }

  for (const provider of Object.values(OAUTH_PROVIDERS)) {
    for (const [serviceId, service] of Object.entries(provider.services)) {
      for (const integrationType of getIntegrationTypesForOAuthServiceId(serviceId)) {
        const integration = INTEGRATION_BY_TYPE.get(integrationType)
        if (!integration) continue
        add(service.providerId, integration)
        add(service.serviceAccountProviderId, integration)
        for (const extraProviderId of service.additionalProviderIds ?? []) {
          add(extraProviderId, integration)
        }
      }
    }
  }

  const catalogOrder = new Map(
    INTEGRATIONS_DATA.map((integration, order) => [integration.type, order])
  )
  for (const covered of index.values()) {
    covered.sort(
      (left, right) => (catalogOrder.get(left.type) ?? 0) - (catalogOrder.get(right.type) ?? 0)
    )
  }
  return index
})()

/** Catalog integrations a credential of this provider id can authenticate. */
export function getIntegrationsForCredentialProvider(providerId: string): readonly Integration[] {
  return INTEGRATIONS_BY_CREDENTIAL_PROVIDER.get(providerId) ?? []
}

/**
 * Whether this provider id is a service-account id shared across more than one
 * catalog integration — one Atlassian API token covers Jira, Jira Service
 * Management, and Confluence; one Google JSON key covers every Google
 * integration. Derived from the catalog, so a new integration joining a family
 * is picked up with no edit here.
 */
export function isFamilyServiceAccount(providerId: string): boolean {
  return (
    SERVICE_ACCOUNT_PROVIDER_IDS.has(providerId) &&
    getIntegrationsForCredentialProvider(providerId).length > 1
  )
}

/**
 * Base provider entry owning a family service-account id.
 *
 * `parseProvider` is the right lookup because it resolves an id to the service
 * that registers it as its own `providerId` before falling back — which is how
 * `atlassian-service-account` reaches the `atlassian` provider rather than
 * Confluence, the first service that merely *references* it.
 */
function getFamilyProvider(providerId: string) {
  if (!isFamilyServiceAccount(providerId)) return null
  const { baseProvider } = parseProvider(providerId as OAuthProvider)
  return OAUTH_PROVIDERS[baseProvider] ?? null
}

/** Vendor name for a family service account ("Atlassian", "Google"), else null. */
export function getServiceAccountFamilyName(providerId: string): string | null {
  return getFamilyProvider(providerId)?.name ?? null
}

/** Corporate mark for a family service account, else null. */
export function getServiceAccountFamilyIcon(
  providerId: string
): ComponentType<{ className?: string }> | null {
  const icon = getFamilyProvider(providerId)?.icon
  return (icon as ComponentType<{ className?: string }> | undefined) ?? null
}

/**
 * Sentence naming what a family service account reaches, for connect-time copy
 * and credential subtitles. Returns null for non-family providers.
 */
export function getServiceAccountCoverageSentence(providerId: string): string | null {
  const familyName = getServiceAccountFamilyName(providerId)
  if (!familyName) return null
  const covered = getIntegrationsForCredentialProvider(providerId)
  if (covered.length > MAX_ENUMERATED_INTEGRATIONS) {
    return `One token works across all ${covered.length} ${familyName} integrations.`
  }
  return `One token works across ${formatList(covered.map((i) => i.name))}.`
}

/** Oxford-comma list: "Jira", "Jira and Confluence", "A, B, and C". */
function formatList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

/** Minimal credential shape this module needs — structurally satisfied by `WorkspaceCredential`. */
interface DisplayableCredential {
  type: string
  displayName: string
  providerId: string | null
}

export interface CredentialDisplay {
  /** Resolved OAuth service config, or null when the provider is unknown. */
  service: OAuthServiceConfig | null
  /**
   * Catalog integration lending the brand tile and category. For a family
   * service account this is the family's canonical integration, since no single
   * product owns the credential.
   */
  integration: Integration | null
  /** `integration.type`, or '' — drives the brand tile background. */
  blockType: string
  /** Mark to render: the family's corporate icon, else the service's own. */
  icon: ComponentType<{ className?: string }> | null
  /** Vendor name when this is a family service account, else null. */
  familyName: string | null
  /** Catalog integrations this credential authenticates, in catalog order. */
  coveredIntegrations: readonly Integration[]
  /**
   * Generated sentence describing the credential's service and reach. Never the
   * user's own description — list surfaces prefer `credential.description` and
   * fall back to this.
   */
  subtitle: string
  /** Header title for the credential detail page. */
  detailTitle: string
  /**
   * Header subtitle for the credential detail page. Only a family service
   * account needs its reach spelled out there; every other credential keeps the
   * service's own richer description, which the page has always shown and which
   * beats restating the title ("Jira" over "Jira integration").
   */
  detailSubtitle: string
}

/**
 * Resolves everything a surface needs to render a credential. Pure and
 * server-safe apart from the icon components it passes through, so it may be
 * imported by server components as well as client ones.
 */
export function resolveCredentialDisplay(credential: DisplayableCredential): CredentialDisplay {
  const providerId = credential.providerId
  const isServiceAccount = credential.type === 'service_account'
  if (credential.type === 'personal_token' && providerId === 'gitlab') {
    const integration = INTEGRATION_BY_SLUG.get('gitlab') ?? null
    return {
      service: null,
      integration,
      blockType: 'gitlab',
      icon: GitlabIcon,
      familyName: null,
      coveredIntegrations: integration ? [integration] : [],
      subtitle: 'Your personal GitLab account',
      detailTitle: 'GitLab',
      detailSubtitle: 'Only you can use this connection.',
    }
  }

  if (!providerId) {
    return {
      service: null,
      integration: null,
      blockType: '',
      icon: null,
      familyName: null,
      coveredIntegrations: [],
      subtitle: 'Connected service',
      detailTitle: credential.displayName,
      detailSubtitle: 'Connected service',
    }
  }

  const service = getServiceConfigByProviderId(providerId)
  const familyName = getServiceAccountFamilyName(providerId)
  const coveredIntegrations = getIntegrationsForCredentialProvider(providerId)
  const integration = resolveCatalogIntegration(providerId, service, Boolean(familyName))

  const subtitle = buildSubtitle({
    providerId,
    service,
    familyName,
    coveredIntegrations,
    isServiceAccount,
  })

  return {
    service,
    integration,
    blockType: integration?.type ?? '',
    icon:
      getServiceAccountFamilyIcon(providerId) ??
      (service?.icon as ComponentType<{ className?: string }> | undefined) ??
      null,
    familyName,
    coveredIntegrations,
    subtitle,
    detailTitle: isServiceAccount
      ? credential.displayName
      : (service?.name ?? credential.displayName),
    detailSubtitle: familyName ? subtitle : (service?.description ?? subtitle),
  }
}

/**
 * Catalog entry lending brand tile and category.
 *
 * A family service account goes straight to its canonical slug: resolving by
 * service name would land on whichever product the resolver happened to pick
 * (`google-service-account` → Gmail), which is arbitrary. Everything else keeps
 * the long-standing name lookup.
 */
function resolveCatalogIntegration(
  providerId: string,
  service: OAuthServiceConfig | null,
  isFamily: boolean
): Integration | null {
  if (isFamily) {
    const slug = CANONICAL_SERVICE_ACCOUNT_SLUGS[providerId]
    const canonical = slug ? INTEGRATION_BY_SLUG.get(slug) : undefined
    if (canonical) return canonical
  }
  if (!service) return null
  const byName = INTEGRATION_BY_LOWER_NAME.get(service.name.toLowerCase())
  if (byName) return byName
  // Last resort: any integration this credential authenticates, so a credential
  // never loses its category filter membership.
  return getIntegrationsForCredentialProvider(providerId)[0] ?? null
}

interface SubtitleArgs {
  providerId: string
  service: OAuthServiceConfig | null
  familyName: string | null
  coveredIntegrations: readonly Integration[]
  isServiceAccount: boolean
}

/**
 * Vendor-accurate nouns come from {@link getServiceAccountConnectNoun}, the
 * same source the connect controls use, so a Slack credential reads "custom
 * bot" here exactly as its setup button does.
 */
function buildSubtitle({
  providerId,
  service,
  familyName,
  coveredIntegrations,
  isServiceAccount,
}: SubtitleArgs): string {
  if (familyName) {
    const scope =
      coveredIntegrations.length > MAX_ENUMERATED_INTEGRATIONS
        ? `all ${coveredIntegrations.length} ${familyName} integrations`
        : formatList(coveredIntegrations.map((i) => i.name))
    return `${familyName} ${getServiceAccountConnectNoun(providerId)} · ${scope}`
  }
  if (!service) return 'Connected service'
  return isServiceAccount
    ? `${service.name} ${getServiceAccountConnectNoun(providerId)}`
    : `${service.name} integration`
}
