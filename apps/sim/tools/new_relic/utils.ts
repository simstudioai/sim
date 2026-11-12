import type { NewRelicEntity } from '@/tools/new_relic/types'
import { defineCredentialRegions } from '@/tools/shared/credential-regions'

interface GraphQLError {
  message?: string
}

export interface NewRelicRawEntity {
  guid?: string | null
  name?: string | null
  entityType?: string | null
  domain?: string | null
  reporting?: boolean | null
  alertSeverity?: string | null
  tags?: ({ key?: string | null; values?: string[] | null } | null)[] | null
}

interface GraphQLResponse<TData> {
  data?: TData
  errors?: GraphQLError[]
}

/**
 * NerdGraph endpoint of each New Relic data center; a User API key only works in its own.
 * FedRAMP accounts have no NerdGraph host of their own and use the US endpoint.
 * See https://docs.newrelic.com/docs/apis/nerdgraph/get-started/introduction-new-relic-nerdgraph/
 * and https://docs.newrelic.com/docs/security/security-privacy/compliance/fedramp-compliant-endpoints/
 */
export const NEW_RELIC_REGIONS = defineCredentialRegions({
  service: 'New Relic',
  noun: 'region',
  regions: {
    us: { origin: 'https://api.newrelic.com', label: 'US' },
    eu: { origin: 'https://api.eu.newrelic.com', label: 'EU' },
    jp: { origin: 'https://api.jp.newrelic.com', label: 'JP' },
  },
  defaultRegion: 'us',
  basePath: '/graphql',
})

/** Anything but a known region resolves to the US endpoint, as workflows saved before regions expect. */
export const getNerdGraphEndpoint = (region?: string): string =>
  NEW_RELIC_REGIONS.apiBase(region && NEW_RELIC_REGIONS.has(region) ? region : undefined)

export const newRelicHeaders = (apiKey: string): Record<string, string> => ({
  'API-Key': apiKey,
  'Content-Type': 'application/json',
})

export const gqlString = (value: string): string => JSON.stringify(value)

export async function parseNerdGraphResponse<TData>(
  response: Response
): Promise<GraphQLResponse<TData>> {
  const payload = (await response.json().catch(() => ({}))) as GraphQLResponse<TData>

  if (!response.ok || payload.errors?.length) {
    const message =
      payload.errors
        ?.map((error) => error.message)
        .filter((errorMessage): errorMessage is string => Boolean(errorMessage))
        .join('; ') || `HTTP ${response.status}: ${response.statusText}`
    throw new Error(message)
  }

  return payload
}

export const cleanOptionalString = (value?: string): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const normalizeNewRelicEntity = (entity: NewRelicRawEntity): NewRelicEntity => ({
  guid: entity.guid ?? null,
  name: entity.name ?? null,
  entityType: entity.entityType ?? null,
  domain: entity.domain ?? null,
  reporting: entity.reporting ?? null,
  alertSeverity: entity.alertSeverity ?? null,
  tags:
    entity.tags?.map((tag) => ({
      key: tag?.key ?? null,
      values: tag?.values ?? [],
    })) ?? [],
})
