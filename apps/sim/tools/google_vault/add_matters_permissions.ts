import type { GoogleVaultAddMatterPermissionsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const addMattersPermissionsTool: ToolConfig<GoogleVaultAddMatterPermissionsParams> = {
  id: 'google_vault_add_matters_permissions',
  name: 'Vault Add Matter Collaborator',
  description: 'Add a collaborator (or transfer ownership) to a matter',
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
      description: 'Admin SDK account ID of the user to add as a collaborator/owner',
    },
    role: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Permission level to grant: COLLABORATOR or OWNER',
    },
    sendEmails: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Send a notification email to the added account',
    },
    ccMe: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'CC the requestor on the notification email (only relevant if sendEmails is true)',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}:addPermissions`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      matterPermission: { accountId: params.accountId, role: params.role },
      sendEmails: params.sendEmails,
      ccMe: params.ccMe,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to add matter collaborator'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { permission: data } }
  },

  outputs: {
    permission: { type: 'json', description: 'Created matter permission (accountId, role)' },
  },
}
