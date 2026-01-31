import { buildMailchimpUrl, handleMailchimpError, type MailchimpTag } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetMemberTagsParams {
  apiKey: string
  listId: string
  subscriberEmail: string
}

export interface MailchimpGetMemberTagsResponse {
  success: boolean
  output: {
    tags: MailchimpTag[]
    total_items: number
    total_returned: number
  }
}

export const mailchimpGetMemberTagsTool: ToolConfig<
  MailchimpGetMemberTagsParams,
  MailchimpGetMemberTagsResponse
> = {
  id: 'mailchimp_get_member_tags',
  name: 'Get Member Tags from Mailchimp',
  description: 'Retrieve tags associated with a member in a Mailchimp audience',
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
    subscriberEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Member email address or MD5 hash of the lowercase email',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/members/${params.subscriberEmail}/tags`
      ),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_member_tags')
    }

    const data = await response.json()
    const tags = data.tags || []

    return {
      success: true,
      output: {
        tags,
        total_items: data.total_items || tags.length,
        total_returned: tags.length,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the member tags were successfully retrieved',
    },
    output: {
      type: 'object',
      description: 'Member tags data',
      properties: {
        tags: { type: 'json', description: 'Array of tag objects' },
        total_items: { type: 'number', description: 'Total number of tags' },
        total_returned: { type: 'number', description: 'Number of tags returned in this response' },
      },
    },
  },
}
