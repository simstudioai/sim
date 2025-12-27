import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteAudience')

export interface MailchimpDeleteAudienceParams {
  apiKey: string
  listId: string
}

export interface MailchimpDeleteAudienceResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_audience'
      listId: string
    }
    success: boolean
  }
}

export const mailchimpDeleteAudienceTool: ToolConfig<
  MailchimpDeleteAudienceParams,
  MailchimpDeleteAudienceResponse
> = {
  id: 'mailchimp_delete_audience',
  name: 'Delete Audience from Mailchimp',
  description: 'Delete an audience (list) from Mailchimp',
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
      description: 'The unique ID for the list to delete',
    },
  },

  request: {
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}`),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_audience')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'delete_audience' as const,
          listId: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
