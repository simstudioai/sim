import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAudience } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

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
    metadata: {
      operation: 'create_audience'
      listId: string
    }
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
      visibility: 'user-only',
      description: 'The name of the list',
    },
    contact: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON object of contact information',
    },
    permissionReminder: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Permission reminder text',
    },
    campaignDefaults: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON object of default campaign settings',
    },
    emailTypeOption: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Support multiple email formats',
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
        metadata: {
          operation: 'create_audience' as const,
          listId: data.id,
        },
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
        list: { type: 'object', description: 'Created audience/list object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
