import type { GoogleVaultListMattersHoldsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const listMattersHoldsTool: ToolConfig<GoogleVaultListMattersHoldsParams> = {
  id: 'google_vault_list_matters_holds',
  name: 'Vault List Holds',
  description: 'List holds for a matter',
  version: '1.0',

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
      description: 'Number of holds to return per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Token for pagination',
    },
    holdId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional hold ID to fetch a specific hold (e.g., "holdId123456")',
    },
  },

  request: {
    url: (params) => {
      if (params.holdId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}/holds/${params.holdId}`
      }
      const url = new URL(`https://vault.googleapis.com/v1/matters/${params.matterId}/holds`)
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

  transformResponse: async (response: Response, params?: GoogleVaultListMattersHoldsParams) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list holds'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    if (params?.holdId) {
      return { success: true, output: { hold: data } }
    }
    return { success: true, output: data }
  },

  outputs: {
    holds: { type: 'json', description: 'Array of hold objects' },
    hold: { type: 'json', description: 'Single hold object (when holdId is provided)' },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
