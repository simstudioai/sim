import type { GoogleVaultCreateMattersParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const createMattersTool: ToolConfig<GoogleVaultCreateMattersParams> = {
  id: 'google_vault_create_matters',
  name: 'Vault Create Matter',
  description: 'Create a new matter in Google Vault',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Name for the new matter',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional description for the matter',
    },
  },

  request: {
    url: () => `https://vault.googleapis.com/v1/matters`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ name: params.name, description: params.description }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to create matter'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { matter: data } }
  },

  outputs: {
    matter: { type: 'json', description: 'Created matter object' },
  },
}
