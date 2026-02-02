import type { MailchimpAudience } from '@/tools/mailchimp/types'
import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetAudienceParams {
  apiKey: string
  listId: string
}

export interface MailchimpGetAudienceResponse {
  success: boolean
  output: {
    list: MailchimpAudience
    list_id: string
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list (e.g., "abc123def4")',
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
        list_id: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the audience was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Audience data',
      properties: {
        list: { type: 'json', description: 'Audience/list object' },
        list_id: { type: 'string', description: 'The unique ID of the audience' },
      },
    },
  },
}
