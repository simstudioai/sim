import type { GoogleVaultListMattersParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const listMattersTool: ToolConfig<GoogleVaultListMattersParams> = {
  id: 'google_vault_list_matters',
  name: 'Vault List Matters',
  description: 'List matters, or get a specific matter if matterId is provided',
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
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of matters to return per page',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Token for pagination',
    },
    matterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional matter ID to fetch a specific matter (e.g., "12345678901234567890")',
    },
  },

  request: {
    url: (params) => {
      if (params.matterId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}`
      }
      const url = new URL('https://vault.googleapis.com/v1/matters')
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

  transformResponse: async (response: Response, params?: GoogleVaultListMattersParams) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to list matters'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    if (params?.matterId) {
      return { success: true, output: { matter: data } }
    }
    return { success: true, output: data }
  },

  outputs: {
    matters: { type: 'json', description: 'Array of matter objects' },
    matter: { type: 'json', description: 'Single matter object (when matterId is provided)' },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
