import type {
  DocuSignListEnvelopesParams,
  DocuSignListEnvelopesResponse,
} from '@/tools/docusign/types'
import { ENVELOPES_ARRAY_OUTPUT } from '@/tools/docusign/types'
import type { ToolConfig } from '@/tools/types'

export const docusignListEnvelopesTool: ToolConfig<
  DocuSignListEnvelopesParams,
  DocuSignListEnvelopesResponse
> = {
  id: 'docusign_list_envelopes',
  name: 'List DocuSign Envelopes',
  description: 'List envelopes from your DocuSign account with optional filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'docusign',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'DocuSign OAuth access token',
    },
    fromDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date filter (ISO 8601). Defaults to 30 days ago',
    },
    toDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date filter (ISO 8601)',
    },
    envelopeStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status: created, sent, delivered, completed, declined, voided',
    },
    searchText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text to filter envelopes',
    },
    count: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of envelopes to return (default: 25)',
    },
  },

  request: {
    url: '/api/tools/docusign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      operation: 'list_envelopes',
      fromDate: params.fromDate,
      toDate: params.toDate,
      envelopeStatus: params.envelopeStatus,
      searchText: params.searchText,
      count: params.count,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (data.success === false) {
      throw new Error(data.error || 'Failed to list envelopes')
    }
    const envelopes = (data.envelopes ?? []).map((env: Record<string, unknown>) => ({
      envelopeId: env.envelopeId ?? null,
      status: env.status ?? null,
      emailSubject: env.emailSubject ?? null,
      sentDateTime: env.sentDateTime ?? null,
      completedDateTime: env.completedDateTime ?? null,
      createdDateTime: env.createdDateTime ?? null,
      statusChangedDateTime: env.statusChangedDateTime ?? null,
    }))
    return {
      success: true,
      output: {
        envelopes,
        totalSetSize: Number(data.totalSetSize) || 0,
        resultSetSize: Number(data.resultSetSize) || envelopes.length,
      },
    }
  },

  outputs: {
    envelopes: ENVELOPES_ARRAY_OUTPUT,
    totalSetSize: { type: 'number', description: 'Total number of matching envelopes' },
    resultSetSize: { type: 'number', description: 'Number of envelopes returned in this response' },
  },
}
