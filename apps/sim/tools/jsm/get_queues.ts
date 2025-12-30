import type { JsmGetQueuesParams, JsmGetQueuesResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetQueuesTool: ToolConfig<JsmGetQueuesParams, JsmGetQueuesResponse> = {
  id: 'jsm_get_queues',
  name: 'JSM Get Queues',
  description: 'Get queues for a service desk in Jira Service Management',
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
      visibility: 'user-only',
      description: 'Service Desk ID to get queues for',
    },
    includeCount: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include issue count for each queue',
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
    url: '/api/tools/jsm/queues',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
      includeCount: params.includeCount,
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
          queues: [],
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
        queues: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    queues: { type: 'json', description: 'Array of queues' },
    total: { type: 'number', description: 'Total number of queues' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
