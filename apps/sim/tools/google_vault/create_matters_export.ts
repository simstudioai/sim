import type { GoogleVaultCreateMattersExportParams } from '@/tools/google_vault/types'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'
import type { ToolConfig } from '@/tools/types'

export const createMattersExportTool: ToolConfig<GoogleVaultCreateMattersExportParams> = {
  id: 'google_vault_create_matters_export',
  name: 'Vault Create Export',
  description: 'Create an export in a matter',
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
    exportName: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Name for the export (avoid special characters)',
    },
    corpus: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Data corpus to export (MAIL, DRIVE, GROUPS, HANGOUTS_CHAT, VOICE)',
    },
    accountEmails: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of user emails to scope export (e.g., "user1@example.com, user2@example.com")',
    },
    orgUnitId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Organization unit ID to scope export (e.g., "id:03ph8a2z1enx5q0", alternative to emails)',
    },
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start time for date filtering (ISO 8601 format, e.g., "2024-01-01T00:00:00Z")',
    },
    endTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End time for date filtering (ISO 8601 format, e.g., "2024-12-31T23:59:59Z")',
    },
    terms: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search query terms to filter exported content (e.g., "from:sender@example.com subject:invoice")',
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
      const errorMessage = data.error?.message || 'Failed to create export'
      throw new Error(enhanceGoogleVaultError(errorMessage))
    }
    return { success: true, output: { export: data } }
  },

  outputs: {
    export: { type: 'json', description: 'Created export object' },
  },
}
