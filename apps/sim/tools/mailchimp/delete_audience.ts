import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteAudienceParams {
  apiKey: string
  listId: string
}

export interface MailchimpDeleteAudienceResponse {
  success: boolean
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
      visibility: 'user-or-llm',
      description: 'The unique ID for the audience/list to delete (e.g., "abc123def4")',
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
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the audience was successfully deleted' },
  },
}
