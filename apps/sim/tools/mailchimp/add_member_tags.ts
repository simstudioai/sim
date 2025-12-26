import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpAddMemberTags')

export interface MailchimpAddMemberTagsParams {
  apiKey: string
  listId: string
  subscriberEmail: string
  tags: string
}

export interface MailchimpAddMemberTagsResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'add_member_tags'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpAddMemberTagsTool: ToolConfig<
  MailchimpAddMemberTagsParams,
  MailchimpAddMemberTagsResponse
> = {
  id: 'mailchimp_add_member_tags',
  name: 'Add Tags to Member in Mailchimp',
  description: 'Add tags to a member in a Mailchimp audience',
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
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'JSON array of tags',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/members/${params.subscriberEmail}/tags`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let tags = []
      try {
        tags = JSON.parse(params.tags)
      } catch (error) {
        logger.warn('Failed to parse tags', { error })
      }

      return { tags }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'add_member_tags')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'add_member_tags' as const,
          subscriberHash: '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Tag addition confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
