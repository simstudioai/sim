import { createLogger } from '@sim/logger'
import type { MailchimpAudience } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MailchimpCreateAudience')

export interface MailchimpCreateAudienceParams {
  apiKey: string
  audienceName: string
  contact: string
  permissionReminder: string
  campaignDefaults: string
  emailTypeOption: string
}

export interface MailchimpCreateAudienceResponse {
  success: boolean
  output: {
    list: MailchimpAudience
    list_id: string
    success: boolean
  }
}

export const mailchimpCreateAudienceTool: ToolConfig<
  MailchimpCreateAudienceParams,
  MailchimpCreateAudienceResponse
> = {
  id: 'mailchimp_create_audience',
  name: 'Create Audience in Mailchimp',
  description: 'Create a new audience (list) in Mailchimp',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Mailchimp API key with server prefix',
    },
    audienceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the audience/list (e.g., "Newsletter Subscribers")',
    },
    contact: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of contact information (e.g., {"company": "Acme", "address1": "123 Main St", "city": "NYC", "state": "NY", "zip": "10001", "country": "US"})',
    },
    permissionReminder: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Permission reminder text shown to subscribers (e.g., "You signed up for updates on our website")',
    },
    campaignDefaults: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object of default campaign settings (e.g., {"from_name": "Acme", "from_email": "news@acme.com", "subject": "", "language": "en"})',
    },
    emailTypeOption: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Support multiple email formats: "true" or "false"',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, '/lists'),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.audienceName,
        permission_reminder: params.permissionReminder,
        email_type_option: params.emailTypeOption === 'true',
      }

      if (params.contact) {
        try {
          body.contact = JSON.parse(params.contact)
        } catch (error) {
          logger.warn('Failed to parse contact', { error })
        }
      }

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
      handleMailchimpError(data, response.status, 'create_audience')
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
      description: 'Created audience data',
      properties: {
        list: { type: 'json', description: 'Created audience/list object' },
        list_id: { type: 'string', description: 'Created audience/list ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
