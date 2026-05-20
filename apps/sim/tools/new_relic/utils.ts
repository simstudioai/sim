import type { NewRelicRegion } from '@/tools/new_relic/types'

interface GraphQLError {
  message?: string
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
