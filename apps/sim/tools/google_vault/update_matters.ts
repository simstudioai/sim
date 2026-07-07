import type { GoogleVaultUpdateMatterParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const updateMattersTool: ToolConfig<GoogleVaultUpdateMatterParams> = {
  id: 'google_vault_update_matters',
  name: 'Vault Update Matter',
  description: 'Update the name and/or description of a matter',
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
      description: 'The matter ID to update (e.g., "12345678901234567890")',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'New name for the matter',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'New description for the matter',
    },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ name: params.name, description: params.description }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to update matter'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { matter: data } }
  },

  outputs: {
    matter: { type: 'json', description: 'Updated matter object' },
  },
}
