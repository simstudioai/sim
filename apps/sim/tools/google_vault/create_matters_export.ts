import type { GoogleVaultCreateMattersExportParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

// matters.exports.create
// POST https://vault.googleapis.com/v1/matters/{matterId}/exports
export const createMattersExportTool: ToolConfig<GoogleVaultCreateMattersExportParams> = {
  id: 'create_matters_export',
  name: 'Vault Create Export (by Matter)',
  description: 'Create an export in a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
  },

  params: {
    accessToken: { type: 'string', required: true, visibility: 'hidden' },
    matterId: { type: 'string', required: true, visibility: 'user-only' },
    exportName: { type: 'string', required: true, visibility: 'user-only' },
    corpus: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Data corpus to export (MAIL, DRIVE, GROUPS, HANGOUTS_CHAT, VOICE)',
    },
    accountEmails: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of user emails to scope export',
    },
    orgUnitId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Organization unit ID to scope export (alternative to emails)',
    },
  },

  request: {
    url: (params) => `https://vault.googleapis.com/v1/matters/${params.matterId}/exports`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
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

      const scope =
        emails.length > 0
          ? { accountInfo: { emails } }
          : params.orgUnitId
            ? { orgUnitInfo: { orgUnitId: params.orgUnitId } }
            : {}

      const searchMethod = emails.length > 0 ? 'ACCOUNT' : params.orgUnitId ? 'ORG_UNIT' : undefined

      const query: any = {
        corpus: params.corpus,
        dataScope: 'ALL_DATA',
        searchMethod: searchMethod,
        terms: params.terms || undefined,
        startTime: params.startTime || undefined,
        endTime: params.endTime || undefined,
        timeZone: params.timeZone || undefined,
        ...scope,
      }

      return {
        name: params.exportName,
        query,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create export')
    }
    return { success: true, output: data }
  },
}
