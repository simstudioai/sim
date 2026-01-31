import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpStartAutomationParams {
  apiKey: string
  workflowId: string
}

export interface MailchimpStartAutomationResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpStartAutomationTool: ToolConfig<
  MailchimpStartAutomationParams,
  MailchimpStartAutomationResponse
> = {
  id: 'mailchimp_start_automation',
  name: 'Start Automation in Mailchimp',
  description: 'Start all emails in a Mailchimp automation workflow',
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
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/automations/${params.workflowId}/actions/start-all-emails`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'start_automation')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Start confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
