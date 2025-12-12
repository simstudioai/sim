import type { ToolConfig } from '@/tools/types'

export interface GoogleVaultCreateMattersParams {
  accessToken: string
  name: string
  description?: string
}

// matters.create
// POST https://vault.googleapis.com/v1/matters
export const createMattersTool: ToolConfig<GoogleVaultCreateMattersParams> = {
  id: 'create_matters',
  name: 'Vault Create Matter',
  description: 'Create a new matter in Google Vault',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    name: { type: 'string', required: true, visibility: 'user-only' },
    description: { type: 'string', required: false, visibility: 'user-only' },
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
      throw new Error(data.error?.message || 'Failed to create matter')
    }
    return { success: true, output: data }
  },
}
