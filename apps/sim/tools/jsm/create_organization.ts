import type { JsmCreateOrganizationParams, JsmCreateOrganizationResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmCreateOrganizationTool: ToolConfig<
  JsmCreateOrganizationParams,
  JsmCreateOrganizationResponse
> = {
  id: 'jsm_create_organization',
  name: 'JSM Create Organization',
  description: 'Create a new organization in Jira Service Management',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the organization to create',
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
      name: params.name,
      action: 'create',
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          organizationId: '',
          name: '',
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
        organizationId: '',
        name: '',
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    organizationId: { type: 'string', description: 'ID of the created organization' },
    name: { type: 'string', description: 'Name of the created organization' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
