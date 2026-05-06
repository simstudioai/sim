import type { SESListIdentitiesParams, SESListIdentitiesResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const listIdentitiesTool: ToolConfig<SESListIdentitiesParams, SESListIdentitiesResponse> = {
  id: 'ses_list_identities',
  name: 'SES List Identities',
  description:
    'List all verified email identities (email addresses and domains) in your SES account',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of identities to return (1-1000)',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous list response',
    },
  },

  request: {
    url: '/api/tools/ses/list-identities',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      pageSize: params.pageSize,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list identities')
    }

    return {
      success: true,
      output: {
        identities: data.identities ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    identities: {
      type: 'array',
      description:
        'List of email identities with name, type, sending status, and verification status',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of identities returned' },
  },
}
