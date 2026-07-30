import type { GoogleVaultMatterActionParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const closeMattersTool: ToolConfig<GoogleVaultMatterActionParams> = {
  id: 'google_vault_close_matters',
  name: 'Vault Close Matter',
  description: 'Close a matter',
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
      description: 'The matter ID to close (e.g., "12345678901234567890")',
    },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}:close`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to close matter'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { matter: data.matter ?? data } }
  },

  outputs: {
    matter: { type: 'json', description: 'Closed matter object' },
  },
}
