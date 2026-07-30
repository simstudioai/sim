import type { GoogleVaultDeleteMattersExportParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteMattersExportTool: ToolConfig<GoogleVaultDeleteMattersExportParams> = {
  id: 'google_vault_delete_matters_export',
  name: 'Vault Delete Export',
  description: 'Delete an export from a matter',
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
    exportId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The export ID to delete (e.g., "exportId123456")',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/exports/${params.exportId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = data.error?.message || 'Failed to delete export'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the export was deleted' },
  },
}
