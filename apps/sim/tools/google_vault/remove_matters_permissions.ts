import type { GoogleVaultRemoveMatterPermissionsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const removeMattersPermissionsTool: ToolConfig<GoogleVaultRemoveMatterPermissionsParams> = {
  id: 'google_vault_remove_matters_permissions',
  name: 'Vault Remove Matter Collaborator',
  description: 'Remove a collaborator from a matter',
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
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Admin SDK account ID of the collaborator to remove',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}:removePermissions`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ accountId: params.accountId }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      const errorMessage = data.error?.message || 'Failed to remove matter collaborator'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the collaborator was removed' },
  },
}
