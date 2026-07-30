import type { GoogleVaultMatterActionParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteMattersTool: ToolConfig<GoogleVaultMatterActionParams> = {
  id: 'google_vault_delete_matters',
  name: 'Vault Delete Matter',
  description: 'Permanently delete a matter (must be closed first)',
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
      description: 'The matter ID to delete (e.g., "12345678901234567890")',
    },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = data.error?.message || 'Failed to delete matter'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    const data = await response.json().catch(() => ({}))
    return { success: true, output: { matter: data.matter ?? data } }
  },

  outputs: {
    matter: { type: 'json', description: 'Deleted matter object' },
  },
}
