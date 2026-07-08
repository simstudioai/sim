import type { GoogleVaultRemoveHeldAccountsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const removeHeldAccountsTool: ToolConfig<GoogleVaultRemoveHeldAccountsParams> = {
  id: 'google_vault_remove_held_accounts',
  name: 'Vault Remove Held Accounts',
  description: 'Remove accounts from an existing hold',
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
    holdId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The hold ID to remove accounts from (e.g., "holdId123456")',
    },
    accountIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of Admin SDK account IDs to remove from the hold (e.g., "accountId1, accountId2")',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/holds/${params.holdId.trim()}:removeHeldAccounts`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const accountIds = params.accountIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
      return { accountIds }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to remove held accounts'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { statuses: data.statuses ?? [] } }
  },

  outputs: {
    statuses: {
      type: 'array',
      description: 'Per-account removal status, in request order',
      items: {
        type: 'json',
        description: 'Status (code, message) for one account removal',
      },
    },
  },
}
