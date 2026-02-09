import type { JsmGetRequestTypesParams, JsmGetRequestTypesResponse } from '@/tools/jsm/types'
import { REQUEST_TYPE_ITEM_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetRequestTypesTool: ToolConfig<
  JsmGetRequestTypesParams,
  JsmGetRequestTypesResponse
> = {
  id: 'jsm_get_request_types',
  name: 'JSM Get Request Types',
  description: 'Get request types for a service desk in Jira Service Management',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    serviceDeskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Service Desk ID (e.g., "1", "2")',
    },
    searchQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter request types by name',
    },
    groupId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by request type group ID',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to expand in the response',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start index for pagination (e.g., 0, 50, 100)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return (e.g., 10, 25, 50)',
    },
  },

  request: {
    url: '/api/tools/jsm/requesttypes',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
      searchQuery: params.searchQuery,
      groupId: params.groupId,
      expand: params.expand,
      start: params.start,
      limit: params.limit,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          requestTypes: [],
          total: 0,
          isLastPage: true,
        },
        error: 'Empty response from API',
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return data
    }

    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        requestTypes: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    requestTypes: {
      type: 'array',
      description: 'List of request types',
      items: {
        type: 'object',
        properties: REQUEST_TYPE_ITEM_PROPERTIES,
      },
    },
    total: { type: 'number', description: 'Total number of request types' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
