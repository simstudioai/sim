import type { GoogleVaultListMattersExportParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

export const listMattersExportTool: ToolConfig<GoogleVaultListMattersExportParams> = {
  id: 'list_matters_export',
  name: 'Vault List Exports (by Matter)',
  description: 'List exports for a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-only' },
    pageSize: { type: 'number', required: false, visibility: 'user-only' },
    pageToken: { type: 'string', required: false, visibility: 'hidden' },
    exportId: { type: 'string', required: false, visibility: 'user-only' },
  },

  request: {
    url: (params) => {
      if (params.exportId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}/exports/${params.exportId}`
      }
      const url = new URL(`https://vault.googleapis.com/v1/matters/${params.matterId}/exports`)
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

  transformResponse: async (response: Response, params?: GoogleVaultListMattersExportParams) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list exports')
    }
    if (params?.exportId) {
      return { success: true, output: { export: data } }
    }
    return { success: true, output: data }
  },

  outputs: {
    exports: { type: 'json', description: 'Array of export objects' },
    export: { type: 'json', description: 'Single export object (when exportId is provided)' },
    nextPageToken: { type: 'string', description: 'Token for fetching next page of results' },
  },
}
