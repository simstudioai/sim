import type {
  SESListSuppressedDestinationsParams,
  SESListSuppressedDestinationsResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const listSuppressedDestinationsTool: ToolConfig<
  SESListSuppressedDestinationsParams,
  SESListSuppressedDestinationsResponse
> = {
  id: 'ses_list_suppressed_destinations',
  name: 'SES List Suppressed Destinations',
  description: 'List email addresses on the account-level SES suppression list',
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
    reasons: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated suppression reasons to filter by: BOUNCE, COMPLAINT',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include addresses suppressed after this ISO 8601 date',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include addresses suppressed before this ISO 8601 date',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return',
    },
    nextToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination token from a previous list response',
    },
  },

  request: {
    url: '/api/tools/ses/list-suppressed-destinations',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      reasons: params.reasons,
      startDate: params.startDate,
      endDate: params.endDate,
      pageSize: params.pageSize,
      nextToken: params.nextToken,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to list suppressed destinations')
    }

    return {
      success: true,
      output: {
        destinations: data.destinations ?? [],
        nextToken: data.nextToken ?? null,
        count: data.count ?? 0,
      },
    }
  },

  outputs: {
    destinations: {
      type: 'array',
      description: 'List of suppressed destinations with email address, reason, and last update',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page of results',
      optional: true,
    },
    count: { type: 'number', description: 'Number of suppressed destinations returned' },
  },
}
