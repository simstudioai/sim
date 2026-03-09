import type { MailchimpMember } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpAddSubscriberToAutomationParams {
  apiKey: string
  workflowId: string
  workflowEmailId: string
  emailAddress: string
}

export interface MailchimpAddSubscriberToAutomationResponse {
  success: boolean
  output: {
    subscriber: MailchimpMember
    success: boolean
  }
}

export const mailchimpAddSubscriberToAutomationTool: ToolConfig<
  MailchimpAddSubscriberToAutomationParams,
  MailchimpAddSubscriberToAutomationResponse
> = {
  id: 'mailchimp_add_subscriber_to_automation',
  name: 'Add Subscriber to Automation in Mailchimp',
  description: 'Manually add a subscriber to a workflow email queue',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    workflowId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the automation workflow (e.g., "abc123def4")',
    },
    workflowEmailId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the workflow email (e.g., "xyz789")',
    },
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the subscriber (e.g., "user@example.com")',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/automations/${params.workflowId}/emails/${params.workflowEmailId}/queue`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      email_address: params.emailAddress,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'add_subscriber_to_automation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        subscriber: data,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Subscriber queue data',
      properties: {
        subscriber: { type: 'json', description: 'Subscriber object' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
