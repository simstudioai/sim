import type { JsmCreateCustomerParams, JsmCreateCustomerResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmCreateCustomerTool: ToolConfig<JsmCreateCustomerParams, JsmCreateCustomerResponse> =
  {
    id: 'jsm_create_customer',
    name: 'JSM Create Customer',
    description: 'Create a new customer in Jira Service Management',
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
      email: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Email address for the new customer',
      },
      displayName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Display name for the new customer',
      },
    },

    request: {
      url: '/api/tools/jsm/customer',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params) => ({
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        email: params.email,
        displayName: params.displayName,
      }),
    },

    transformResponse: async (response: Response) => {
      const responseText = await response.text()

      if (!responseText) {
        return {
          success: false,
          output: {
            ts: new Date().toISOString(),
            accountId: '',
            displayName: '',
            emailAddress: '',
            active: false,
            timeZone: null,
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
          accountId: '',
          displayName: '',
          emailAddress: '',
          active: false,
          timeZone: null,
          success: false,
        },
        error: data.error,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      accountId: { type: 'string', description: 'Account ID of the created customer' },
      displayName: { type: 'string', description: 'Display name of the created customer' },
      emailAddress: { type: 'string', description: 'Email address of the created customer' },
      active: { type: 'boolean', description: 'Whether the customer account is active' },
      timeZone: { type: 'string', description: 'Customer timezone', optional: true },
      success: { type: 'boolean', description: 'Whether the customer was created successfully' },
    },
  }
