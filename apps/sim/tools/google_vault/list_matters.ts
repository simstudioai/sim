import type { ToolConfig } from '@/tools/types'

export interface GoogleVaultListMattersParams {
  accessToken: string
  pageSize?: number
  pageToken?: string
  matterId?: string // Optional get for a specific matter
}

export const listMattersTool: ToolConfig<GoogleVaultListMattersParams> = {
  id: 'list_matters',
  name: 'Vault List Matters',
  description: 'List matters, or get a specific matter if matterId is provided',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    pageSize: { type: 'number', required: false, visibility: 'user-only' },
    pageToken: { type: 'string', required: false, visibility: 'hidden' },
    matterId: { type: 'string', required: false, visibility: 'user-only' },
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
      throw new Error(data.error?.message || 'Failed to list matters')
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
