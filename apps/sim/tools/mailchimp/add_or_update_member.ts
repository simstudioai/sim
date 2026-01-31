import { createLogger } from '@sim/logger'
import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpMember,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('MailchimpAddOrUpdateMember')

export interface MailchimpAddOrUpdateMemberParams {
  apiKey: string
  listId: string
  subscriberEmail: string
  emailAddress: string
  statusIfNew: string
  mergeFields?: string
  interests?: string
}

export interface MailchimpAddOrUpdateMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    subscriber_hash: string
    success: boolean
  }
}

export const mailchimpAddOrUpdateMemberTool: ToolConfig<
  MailchimpAddOrUpdateMemberParams,
  MailchimpAddOrUpdateMemberResponse
> = {
  id: 'mailchimp_add_or_update_member',
  name: 'Add or Update Member in Mailchimp Audience',
  description: 'Add a new member or update an existing member in a Mailchimp audience (upsert)',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Member email address (e.g., "user@example.com")',
    },
    statusIfNew: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Subscriber status if new: "subscribed", "unsubscribed", "cleaned", "pending", or "transactional"',
    },
    mergeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of merge fields (e.g., {"FNAME": "John", "LNAME": "Doe"})',
    },
    interests: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of interest IDs and their boolean values (e.g., {"abc123": true})',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members/${params.subscriberEmail}`),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        email_address: params.emailAddress,
        status_if_new: params.statusIfNew,
      }

      if (params.mergeFields) {
        try {
          body.merge_fields = JSON.parse(params.mergeFields)
        } catch (error) {
          logger.warn('Failed to parse merge fields', { error })
        }
      }

      if (params.interests) {
        try {
          body.interests = JSON.parse(params.interests)
        } catch (error) {
          logger.warn('Failed to parse interests', { error })
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'add_or_update_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        subscriber_hash: data.id,
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Member data',
      properties: {
        member: { type: 'json', description: 'Member object' },
        subscriber_hash: { type: 'string', description: 'Subscriber hash ID' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
