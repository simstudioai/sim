import type { GoogleVaultCreateMattersHoldsParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

// matters.holds.create
// POST https://vault.googleapis.com/v1/matters/{matterId}/holds
export const createMattersHoldsTool: ToolConfig<GoogleVaultCreateMattersHoldsParams> = {
  id: 'create_matters_holds',
  name: 'Vault Create Hold (by Matter)',
  description: 'Create a hold in a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-only' },
    holdName: { type: 'string', required: true, visibility: 'user-only' },
    corpus: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Data corpus to hold (MAIL, DRIVE, GROUPS, HANGOUTS_CHAT, VOICE)',
    },
    accountEmails: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of user emails to put on hold',
    },
    orgUnitId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Organization unit ID to put on hold (alternative to accounts)',
    },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId}/holds`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Build Hold body. One of accounts or orgUnit must be provided.
      const body: any = {
        name: params.holdName,
        corpus: params.corpus,
      }

      // Handle accountEmails - can be string (comma-separated) or array
      let emails: string[] = []
      if (params.accountEmails) {
        if (Array.isArray(params.accountEmails)) {
          emails = params.accountEmails
        } else if (typeof params.accountEmails === 'string') {
          emails = params.accountEmails
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean)
        }
      }

      if (emails.length > 0) {
        // Google Vault expects HeldAccount objects with 'email' or 'accountId'. Use 'email' here.
        body.accounts = emails.map((email: string) => ({ email }))
      } else if (params.orgUnitId) {
        body.orgUnit = { orgUnitId: params.orgUnitId }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create hold')
    }
    return { success: true, output: data }
  },
}
