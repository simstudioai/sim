import type { JsmGetRequestsParams, JsmGetRequestsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetRequestsTool: ToolConfig<JsmGetRequestsParams, JsmGetRequestsResponse> = {
  id: 'jsm_get_requests',
  name: 'JSM Get Requests',
  description: 'Get multiple service requests from Jira Service Management',
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
      required: false,
      visibility: 'user-only',
      description: 'Filter by service desk ID',
    },
    requestOwnership: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Filter by ownership: OWNED_REQUESTS, PARTICIPATED_REQUESTS, ORGANIZATION, ALL_REQUESTS',
    },
    requestStatus: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Filter by status: OPEN, CLOSED, ALL',
    },
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter requests',
    },
    start: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Start index for pagination (default: 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum results to return (default: 50)',
    },
  },

  request: {
    url: '/api/tools/jsm/requests',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
      requestOwnership: params.requestOwnership,
      requestStatus: params.requestStatus,
      searchTerm: params.searchTerm,
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
          requests: [],
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
        requests: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    requests: { type: 'json', description: 'Array of service requests' },
    total: { type: 'number', description: 'Total number of requests' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
