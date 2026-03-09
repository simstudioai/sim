import type { MailchimpAutomation } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetAutomationParams {
  apiKey: string
  workflowId: string
}

export interface MailchimpGetAutomationResponse {
  success: boolean
  output: {
    automation: MailchimpAutomation
    workflow_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the automation workflow (e.g., "abc123def4")',
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
        workflow_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the automation was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Automation data',
      properties: {
        automation: { type: 'json', description: 'Automation object' },
        workflow_id: { type: 'string', description: 'The unique ID of the automation workflow' },
      },
    },
  },
}
