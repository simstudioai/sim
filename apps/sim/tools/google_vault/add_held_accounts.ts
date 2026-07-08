import type { GoogleVaultAddHeldAccountsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const addHeldAccountsTool: ToolConfig<GoogleVaultAddHeldAccountsParams> = {
  id: 'google_vault_add_held_accounts',
  name: 'Vault Add Held Accounts',
  description: 'Add accounts to an existing hold',
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
      description: 'The hold ID to add accounts to (e.g., "holdId123456")',
    },
    accountEmails: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of user emails to add to the hold (e.g., "user1@example.com, user2@example.com")',
    },
  },

  request: {
    url: (params) =>
      `https://vault.googleapis.com/v1/matters/${params.matterId.trim()}/holds/${params.holdId.trim()}:addHeldAccounts`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const emails = params.accountEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
      return { emails }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to add held accounts'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { responses: data.responses ?? [] } }
  },

  outputs: {
    responses: {
      type: 'array',
      description: 'Per-account results of the add operation',
      items: {
        type: 'object',
        properties: {
          account: { type: 'json', description: 'Held account (accountId, email)' },
          status: { type: 'json', description: 'Status (code, message) if the add failed' },
        },
      },
    },
  },
}
