import type { NewRelicEntity, NewRelicRegion } from '@/tools/new_relic/types'

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

export const getNerdGraphEndpoint = (region?: NewRelicRegion): string =>
  region === 'eu' ? 'https://api.eu.newrelic.com/graphql' : 'https://api.newrelic.com/graphql'

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
