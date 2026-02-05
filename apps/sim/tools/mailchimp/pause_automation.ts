import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpPauseAutomationParams {
  apiKey: string
  workflowId: string
}

export interface MailchimpPauseAutomationResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpPauseAutomationTool: ToolConfig<
  MailchimpPauseAutomationParams,
  MailchimpPauseAutomationResponse
> = {
  id: 'mailchimp_pause_automation',
  name: 'Pause Automation in Mailchimp',
  description: 'Pause all emails in a Mailchimp automation workflow',
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
        `/automations/${params.workflowId}/actions/pause-all-emails`
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
      handleMailchimpError(data, response.status, 'pause_automation')
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
      description: 'Pause confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
