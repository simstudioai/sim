import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpRemoveMemberTags')

export interface MailchimpRemoveMemberTagsParams {
  apiKey: string
  listId: string
  subscriberHash: string
  tags: string
}

export interface MailchimpRemoveMemberTagsResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'remove_member_tags'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpRemoveMemberTagsTool: ToolConfig<
  MailchimpRemoveMemberTagsParams,
  MailchimpRemoveMemberTagsResponse
> = {
  id: 'mailchimp_remove_member_tags',
  name: 'Remove Tags from Member in Mailchimp',
  description: 'Remove tags from a member in a Mailchimp audience',
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
    subscriberHash: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "The MD5 hash of the lowercase version of the list member's email address",
    },
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tags as JSON array with inactive status (e.g., [{"name": "tag1", "status": "inactive"}, {"name": "tag2", "status": "inactive"}])',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/members/${params.subscriberHash}/tags`
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
      handleMailchimpError(data, response.status, 'remove_member_tags')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'remove_member_tags' as const,
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
      description: 'Tag removal confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
