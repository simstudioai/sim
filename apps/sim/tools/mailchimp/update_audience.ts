import { createLogger } from '@sim/logger'
import type { MailchimpAudience } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MailchimpUpdateAudience')

export interface MailchimpUpdateAudienceParams {
  apiKey: string
  listId: string
  audienceName?: string
  permissionReminder?: string
  campaignDefaults?: string
  emailTypeOption?: string
}

export interface MailchimpUpdateAudienceResponse {
  success: boolean
  output: {
    list: MailchimpAudience
    list_id: string
    success: boolean
  }
}

export const mailchimpUpdateAudienceTool: ToolConfig<
  MailchimpUpdateAudienceParams,
  MailchimpUpdateAudienceResponse
> = {
  id: 'mailchimp_update_audience',
  name: 'Update Audience in Mailchimp',
  description: 'Update an existing audience (list) in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
    },
    audienceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The name of the audience/list (e.g., "Newsletter Subscribers")',
    },
    permissionReminder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Permission reminder text shown to subscribers (e.g., "You signed up for updates on our website")',
    },
    campaignDefaults: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object of default campaign settings (e.g., {"from_name": "Acme", "from_email": "news@acme.com"})',
    },
    emailTypeOption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Support multiple email formats: "true" or "false"',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.audienceName) body.name = params.audienceName
      if (params.permissionReminder) body.permission_reminder = params.permissionReminder
      if (params.emailTypeOption !== undefined)
        body.email_type_option = params.emailTypeOption === 'true'

      if (params.campaignDefaults) {
        try {
          body.campaign_defaults = JSON.parse(params.campaignDefaults)
        } catch (error) {
          logger.warn('Failed to parse campaign defaults', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'update_audience')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        list: data,
        list_id: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated audience data',
      properties: {
        list: { type: 'object', description: 'Updated audience/list object' },
        list_id: { type: 'string', description: 'List ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
