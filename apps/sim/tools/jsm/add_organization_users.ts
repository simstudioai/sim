import type {
  JsmAddOrganizationUsersParams,
  JsmAddOrganizationUsersResponse,
} from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmAddOrganizationUsersTool: ToolConfig<
  JsmAddOrganizationUsersParams,
  JsmAddOrganizationUsersResponse
> = {
  id: 'jsm_add_organization_users',
  name: 'JSM Add Organization Users',
  description: 'Add users to an organization in Jira Service Management',
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
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization ID to add users to',
    },
    accountIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated account IDs to add to the organization',
    },
  },

  request: {
    url: '/api/tools/jsm/organizationusers',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      organizationId: params.organizationId,
      accountIds: params.accountIds,
      action: 'add',
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
        success: false,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    organizationId: { type: 'string', description: 'Organization ID' },
    success: { type: 'boolean', description: 'Whether users were added successfully' },
  },
}
