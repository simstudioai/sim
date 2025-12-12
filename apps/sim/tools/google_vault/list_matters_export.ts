import type { GoogleVaultListMattersExportParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

// matters.exports.list
// GET https://vault.googleapis.com/v1/matters/{matterId}/exports
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
      // Handle pageSize - convert to number if needed
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

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list exports')
    }

    // Return the raw API response without modifications
    return { success: true, output: data }
  },
}
