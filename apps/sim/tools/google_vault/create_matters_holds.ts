import type { GoogleVaultCreateMattersHoldsParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

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
    terms: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Search terms to filter held content (for MAIL and GROUPS corpus)',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Start time for date filtering (ISO 8601 format, for MAIL and GROUPS corpus)',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'End time for date filtering (ISO 8601 format, for MAIL and GROUPS corpus)',
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
