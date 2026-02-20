import type { JsmRemoveCustomerParams, JsmRemoveCustomerResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmRemoveCustomerTool: ToolConfig<JsmRemoveCustomerParams, JsmRemoveCustomerResponse> =
  {
    id: 'jsm_remove_customer',
    name: 'JSM Remove Customer',
    description: 'Remove customers from a service desk in Jira Service Management',
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
      accountIds: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated Atlassian account IDs to remove',
      },
      emails: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Comma-separated email addresses to remove',
      },
    },

    request: {
      url: '/api/tools/jsm/customers',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        serviceDeskId: params.serviceDeskId,
        accountIds: params.accountIds,
        emails: params.emails,
        action: 'remove',
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
          success: false,
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      serviceDeskId: { type: 'string', description: 'Service desk ID' },
      success: { type: 'boolean', description: 'Whether customers were removed successfully' },
    },
  }
