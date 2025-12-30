import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAutomation } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetAutomation')

export interface MailchimpGetAutomationParams {
  apiKey: string
  workflowId: string
}

export interface MailchimpGetAutomationResponse {
  success: boolean
  output: {
    automation: MailchimpAutomation
    metadata: {
      operation: 'get_automation'
      workflowId: string
    }
    success: boolean
  }
}

export const mailchimpGetAutomationTool: ToolConfig<
  MailchimpGetAutomationParams,
  MailchimpGetAutomationResponse
> = {
  id: 'mailchimp_get_automation',
  name: 'Get Automation from Mailchimp',
  description: 'Retrieve details of a specific automation from Mailchimp',
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
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/automations/${params.workflowId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_automation')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        automation: data,
        metadata: {
          operation: 'get_automation' as const,
          workflowId: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Automation data and metadata',
      properties: {
        automation: { type: 'object', description: 'Automation object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
