import type { RailwayTokenType } from '@/tools/railway/types'

export const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2'

interface RailwayGraphqlError {
  message?: string
}

interface RailwayGraphqlResponse<TData> {
  data?: TData
  errors?: RailwayGraphqlError[]
}

export function railwayHeaders(
  apiKey: string,
  tokenType?: RailwayTokenType
): Record<string, string> {
  if (!apiKey) {
    throw new Error('Missing API token for Railway API request')
  }

  if (tokenType === 'project') {
    return {
      'Content-Type': 'application/json',
      'Project-Access-Token': apiKey,
    }
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

export async function parseRailwayGraphqlResponse<TData>(
  response: Response
): Promise<RailwayGraphqlResponse<TData>> {
  const data = (await response.json()) as RailwayGraphqlResponse<TData>

  if (!response.ok) {
    throw new Error(data.errors?.[0]?.message ?? `HTTP ${response.status}: ${response.statusText}`)
  }

  if (data.errors?.length) {
    throw new Error(data.errors[0]?.message ?? 'Railway API returned a GraphQL error')
  }

  return data
}

export function compactVariables(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

export function optionalString(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
