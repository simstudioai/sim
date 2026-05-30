import type { NewRelicNrqlQueryParams, NewRelicNrqlQueryResponse } from '@/tools/new_relic/types'
import {
  getNerdGraphEndpoint,
  gqlString,
  newRelicHeaders,
  parseNerdGraphResponse,
} from '@/tools/new_relic/utils'
import type { ToolConfig } from '@/tools/types'

interface NrqlQueryData {
  actor?: {
    account?: {
      nrql?: {
        results?: Record<string, unknown>[]
      } | null
    } | null
  } | null
}

export const newRelicNrqlQueryTool: ToolConfig<NewRelicNrqlQueryParams, NewRelicNrqlQueryResponse> =
  {
    id: 'new_relic_nrql_query',
    name: 'New Relic NRQL Query',
    description: 'Run a NRQL query against a New Relic account using NerdGraph.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'New Relic user API key for NerdGraph',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'New Relic data center region: us or eu',
      },
      accountId: {
        type: 'number',
        required: true,
        visibility: 'user-or-llm',
        description: 'New Relic account ID to query',
      },
      nrql: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'NRQL query to execute',
      },
      timeout: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional query timeout in seconds',
      },
    },

    request: {
      url: (params) => getNerdGraphEndpoint(params.region),
      method: 'POST',
      headers: (params) => newRelicHeaders(params.apiKey),
      body: (params) => {
        const timeout = params.timeout ? `, timeout: ${Math.trunc(Number(params.timeout))}` : ''
        return {
          query: `{
  actor {
    account(id: ${Math.trunc(Number(params.accountId))}) {
      nrql(query: ${gqlString(params.nrql)}${timeout}) {
        results
      }
    }
  }
}`,
        }
      },
    },

    transformResponse: async (response) => {
      const payload = await parseNerdGraphResponse<NrqlQueryData>(response)
      const nrql = payload.data?.actor?.account?.nrql
      if (!nrql) {
        throw new Error('New Relic did not return NRQL data for the requested account')
      }
      const results = nrql.results ?? []

      return {
        success: true,
        output: {
          results,
          resultCount: results.length,
        },
      }
    },

    outputs: {
      results: {
        type: 'array',
        description: 'NRQL result rows. Row fields depend on the query projection.',
        items: {
          type: 'object',
          description: 'A NRQL result row',
        },
      },
      resultCount: {
        type: 'number',
        description: 'Number of NRQL result rows returned',
      },
    },
  }
