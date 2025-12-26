import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpMember } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpAddSubscriberToAutomation')

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
    metadata: {
      operation: 'add_subscriber_to_automation'
      workflowId: string
      workflowEmailId: string
    }
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
      visibility: 'user-only',
      description: 'The unique ID for the automation workflow',
    },
    workflowEmailId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the workflow email',
    },
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email address of the subscriber',
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
        metadata: {
          operation: 'add_subscriber_to_automation' as const,
          workflowId: '',
          workflowEmailId: '',
        },
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
        subscriber: { type: 'object', description: 'Subscriber object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
