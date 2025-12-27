import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpTag } from './types'

const logger = createLogger('MailchimpGetMemberTags')

export interface MailchimpGetMemberTagsParams {
  apiKey: string
  listId: string
  subscriberEmail: string
}

export interface MailchimpGetMemberTagsResponse {
  success: boolean
  output: {
    tags: MailchimpTag[]
    totalItems: number
    metadata: {
      operation: 'get_member_tags'
      totalReturned: number
    }
    success: boolean
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    subscriberEmail: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Member email address or MD5 hash',
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
        totalItems: data.total_items || tags.length,
        metadata: {
          operation: 'get_member_tags' as const,
          totalReturned: tags.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Member tags data and metadata',
      properties: {
        tags: { type: 'array', description: 'Array of tag objects' },
        totalItems: { type: 'number', description: 'Total number of tags' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
