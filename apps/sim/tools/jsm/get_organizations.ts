import type { JsmGetOrganizationsParams, JsmGetOrganizationsResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetOrganizationsTool: ToolConfig<
  JsmGetOrganizationsParams,
  JsmGetOrganizationsResponse
> = {
  id: 'jsm_get_organizations',
  name: 'JSM Get Organizations',
  description: 'Get organizations for a service desk in Jira Service Management',
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
    url: '/api/tools/jsm/organizations',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
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
          organizations: [],
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
        organizations: [],
        total: 0,
        isLastPage: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    organizations: { type: 'json', description: 'Array of organizations' },
    total: { type: 'number', description: 'Total number of organizations' },
    isLastPage: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
