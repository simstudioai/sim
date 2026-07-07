import type { GoogleVaultListSavedQueriesParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const listSavedQueriesTool: ToolConfig<GoogleVaultListSavedQueriesParams> = {
  id: 'google_vault_list_saved_queries',
  name: 'Vault List Saved Queries',
  description: 'List saved queries in a matter, or get a specific one if savedQueryId is provided',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
    matterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The matter ID (e.g., "12345678901234567890")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of saved queries to return per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Token for pagination',
    },
    savedQueryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional saved query ID to fetch a specific saved query',
    },
  },

  request: {
    url: (params) => {
      if (params.savedQueryId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/savedQueries/${params.savedQueryId.trim()}`
      }
      const url = new URL(
        `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/savedQueries`
      )
      if (params.pageSize !== undefined && params.pageSize !== null) {
        const pageSize = Number(params.pageSize)
        if (Number.isFinite(pageSize) && pageSize > 0) {
          url.searchParams.set('pageSize', String(pageSize))
        }
      }
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response, params?: GoogleVaultListSavedQueriesParams) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list saved queries'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    if (params?.savedQueryId) {
      return { success: true, output: { savedQuery: data } }
    }
    return { success: true, output: data }
  },

  outputs: {
    savedQueries: { type: 'json', description: 'Array of saved query objects' },
    savedQuery: {
      type: 'json',
      description: 'Single saved query object (when savedQueryId is provided)',
    },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
