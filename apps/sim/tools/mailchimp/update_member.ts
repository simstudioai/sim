import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpMember } from './types'

const logger = createLogger('MailchimpUpdateMember')

export interface MailchimpUpdateMemberParams {
  apiKey: string
  listId: string
  subscriberEmail: string
  emailAddress?: string
  status?: string
  mergeFields?: string
  interests?: string
}

export interface MailchimpUpdateMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    metadata: {
      operation: 'update_member'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpUpdateMemberTool: ToolConfig<
  MailchimpUpdateMemberParams,
  MailchimpUpdateMemberResponse
> = {
  id: 'mailchimp_update_member',
  name: 'Update Member in Mailchimp Audience',
  description: 'Update an existing member in a Mailchimp audience',
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
    emailAddress: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Member email address',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Subscriber status',
    },
    mergeFields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of merge fields',
    },
    interests: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'JSON object of interests',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members/${params.subscriberEmail}`),
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}

      if (params.emailAddress) body.email_address = params.emailAddress
      if (params.status) body.status = params.status

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
      handleMailchimpError(data, response.status, 'update_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        metadata: {
          operation: 'update_member' as const,
          subscriberHash: data.id,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Updated member data',
      properties: {
        member: { type: 'object', description: 'Updated member object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
