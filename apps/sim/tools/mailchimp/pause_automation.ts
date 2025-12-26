import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpPauseAutomation')

export interface MailchimpPauseAutomationParams {
  apiKey: string
  workflowId: string
}

export interface MailchimpPauseAutomationResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'pause_automation'
      workflowId: string
    }
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
      visibility: 'user-only',
      description: 'The unique ID for the automation workflow',
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
        metadata: {
          operation: 'pause_automation' as const,
          workflowId: '',
        },
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
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
