import type { GoogleVaultDeleteSavedQueryParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteSavedQueryTool: ToolConfig<GoogleVaultDeleteSavedQueryParams> = {
  id: 'google_vault_delete_saved_query',
  name: 'Vault Delete Saved Query',
  description: 'Delete a saved query from a matter',
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
    savedQueryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The saved query ID to delete',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/savedQueries/${params.savedQueryId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = data.error?.message || 'Failed to delete saved query'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the saved query was deleted' },
  },
}
