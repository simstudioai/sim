import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAudience } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

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
    metadata: {
      operation: 'update_audience'
      listId: string
    }
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    audienceName: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'The name of the list',
    },
    permissionReminder: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Permission reminder text',
    },
    campaignDefaults: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of default campaign settings',
    },
    emailTypeOption: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Support multiple email formats',
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
        metadata: {
          operation: 'update_audience' as const,
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
      description: 'Updated audience data',
      properties: {
        list: { type: 'object', description: 'Updated audience/list object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
