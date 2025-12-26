import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpAudience } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetAudience')

export interface MailchimpGetAudienceParams {
  apiKey: string
  listId: string
}

export interface MailchimpGetAudienceResponse {
  success: boolean
  output: {
    list: MailchimpAudience
    metadata: {
      operation: 'get_audience'
      listId: string
    }
    success: boolean
  }
}

export const mailchimpGetAudienceTool: ToolConfig<
  MailchimpGetAudienceParams,
  MailchimpGetAudienceResponse
> = {
  id: 'mailchimp_get_audience',
  name: 'Get Audience from Mailchimp',
  description: 'Retrieve details of a specific audience (list) from Mailchimp',
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
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_audience')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        list: data,
        metadata: {
          operation: 'get_audience' as const,
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
      description: 'Audience data and metadata',
      properties: {
        list: { type: 'object', description: 'Audience/list object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
