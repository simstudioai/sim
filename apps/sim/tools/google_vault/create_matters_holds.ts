import type { GoogleVaultCreateMattersHoldsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const createMattersHoldsTool: ToolConfig<GoogleVaultCreateMattersHoldsParams> = {
  id: 'google_vault_create_matters_holds',
  name: 'Vault Create Hold',
  description: 'Create a hold in a matter',
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
    matterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The matter ID (e.g., "12345678901234567890")',
    },
    holdName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Name for the hold',
    },
    corpus: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Data corpus to hold (MAIL, DRIVE, GROUPS, HANGOUTS_CHAT, VOICE)',
    },
    accountEmails: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of user emails to put on hold (e.g., "user1@example.com, user2@example.com")',
    },
    orgUnitId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Organization unit ID to put on hold (e.g., "id:03ph8a2z1enx5q0", alternative to accounts)',
    },
    terms: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search terms to filter held content (e.g., "from:sender@example.com subject:invoice", for MAIL and GROUPS corpus)',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start time for date filtering (ISO 8601 format, e.g., "2024-01-01T00:00:00Z", for MAIL and GROUPS corpus)',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End time for date filtering (ISO 8601 format, e.g., "2024-12-31T23:59:59Z", for MAIL and GROUPS corpus)',
    },
    includeSharedDrives: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include files in shared drives (for DRIVE corpus)',
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
      const body: any = {
        name: params.holdName,
        corpus: params.corpus,
      }

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
        body.accounts = emails.map((email: string) => ({ email }))
      } else if (params.orgUnitId) {
        body.orgUnit = { orgUnitId: params.orgUnitId }
      }

      if (params.corpus === 'MAIL' || params.corpus === 'GROUPS') {
        const hasQueryParams = params.terms || params.startTime || params.endTime
        if (hasQueryParams) {
          const queryObj: any = {}
          if (params.terms) queryObj.terms = params.terms
          if (params.startTime) queryObj.startTime = params.startTime
          if (params.endTime) queryObj.endTime = params.endTime

          if (params.corpus === 'MAIL') {
            body.query = { mailQuery: queryObj }
          } else {
            body.query = { groupsQuery: queryObj }
          }
        }
      } else if (params.corpus === 'DRIVE' && params.includeSharedDrives) {
        body.query = { driveQuery: { includeSharedDriveFiles: params.includeSharedDrives } }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      const errorMessage = data.error?.message || 'Failed to create hold'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { hold: data } }
  },

  outputs: {
    hold: { type: 'json', description: 'Created hold object' },
  },
}
