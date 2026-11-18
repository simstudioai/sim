import { credentialProviderMatchesService, type ServiceProviderIdentity } from '@/lib/oauth/utils'

interface ConnectableService extends ServiceProviderIdentity {
  /** Service key in `OAUTH_PROVIDERS`. */
  id: string
  name: string
}

interface CatalogIntegration {
  name: string
  slug: string
  oauthServiceId?: string
}

/**
 * One connect candidate per catalog integration that no saved credential powers
 * yet. Several services can share an integration (GitHub has its Search App and
 * its saved tokens), so an integration counts as connected when a credential
 * matches any of them — by OAuth id or service-account id — and is offered once,
 * through the service its catalog entry names.
 */
export function unconnectedIntegrations<S extends ConnectableService>(
  services: readonly S[],
  connectedProviderIds: ReadonlySet<string>,
  catalog: readonly CatalogIntegration[]
): { service: S; slug: string }[] {
  const integrationByName = new Map(catalog.map((entry) => [entry.name.toLowerCase(), entry]))
  const servicesBySlug = new Map<string, S[]>()
  for (const service of services) {
    const integration = integrationByName.get(service.name.toLowerCase())
    if (!integration) continue
    const group = servicesBySlug.get(integration.slug)
    if (group) group.push(service)
    else servicesBySlug.set(integration.slug, [service])
  }

  const candidates: { service: S; slug: string }[] = []
  for (const [slug, group] of servicesBySlug) {
    const connected = group.some((service) =>
      [...connectedProviderIds].some((providerId) =>
        credentialProviderMatchesService(providerId, service)
      )
    )
    if (connected) continue
    const oauthServiceId = catalog.find((entry) => entry.slug === slug)?.oauthServiceId
    const service = group.find((candidate) => candidate.id === oauthServiceId) ?? group[0]
    candidates.push({ service, slug })
  }
  return candidates
}
