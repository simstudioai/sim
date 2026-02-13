import type { JsmBaseParams } from '@/tools/jsm/types'
import { SERVICE_DESK_ITEM_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface JsmGetServiceDeskParams extends JsmBaseParams {
  serviceDeskId: string
}

interface JsmGetServiceDeskResponse extends ToolResponse {
  output: {
    ts: string
    id: string
    projectId: string
    projectName: string
    projectKey: string
    name: string
    description: string | null
    leadDisplayName: string | null
  }
}

export const jsmGetServiceDeskTool: ToolConfig<JsmGetServiceDeskParams, JsmGetServiceDeskResponse> =
  {
    id: 'jsm_get_service_desk',
    name: 'JSM Get Service Desk',
    description: 'Get a specific service desk by ID in Jira Service Management',
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
    },

    request: {
      url: '/api/tools/jsm/servicedesks',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        serviceDeskId: params.serviceDeskId,
        action: 'get',
      }),
    },

    transformResponse: async (response: Response) => {
      const responseText = await response.text()

      if (!responseText) {
        return {
          success: false,
          output: {
            ts: new Date().toISOString(),
            id: '',
            projectId: '',
            projectName: '',
            projectKey: '',
            name: '',
            description: null,
            leadDisplayName: null,
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
          id: '',
          projectId: '',
          projectName: '',
          projectKey: '',
          name: '',
          description: null,
          leadDisplayName: null,
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      ...SERVICE_DESK_ITEM_PROPERTIES,
    },
  }
