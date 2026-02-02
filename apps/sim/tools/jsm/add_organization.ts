import type { JsmAddOrganizationParams, JsmAddOrganizationResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAddOrganizationTool: ToolConfig<
  JsmAddOrganizationParams,
  JsmAddOrganizationResponse
> = {
  id: 'jsm_add_organization',
  name: 'JSM Add Organization',
  description: 'Add an organization to a service desk in Jira Service Management',
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
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization ID to add to the service desk',
    },
  },

  request: {
    url: '/api/tools/jsm/organization',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      serviceDeskId: params.serviceDeskId,
      organizationId: params.organizationId,
      action: 'add_to_service_desk',
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          serviceDeskId: '',
          organizationId: '',
          success: false,
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
        serviceDeskId: '',
        organizationId: '',
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    serviceDeskId: { type: 'string', description: 'Service Desk ID' },
    organizationId: { type: 'string', description: 'Organization ID added' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
