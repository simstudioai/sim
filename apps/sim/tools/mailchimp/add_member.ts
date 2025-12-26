import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpMember } from './types'

const logger = createLogger('MailchimpAddMember')

export interface MailchimpAddMemberParams {
  apiKey: string
  listId: string
  emailAddress: string
  status: string
  mergeFields?: string
  interests?: string
}

export interface MailchimpAddMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    metadata: {
      operation: 'add_member'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpAddMemberTool: ToolConfig<
  MailchimpAddMemberParams,
  MailchimpAddMemberResponse
> = {
  id: 'mailchimp_add_member',
  name: 'Add Member to Mailchimp Audience',
  description: 'Add a new member to a Mailchimp audience',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Member email address',
    },
    status: {
      type: 'string',
      required: true,
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
    url: (params) => buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members`),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        email_address: params.emailAddress,
        status: params.status,
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
      handleMailchimpError(data, response.status, 'add_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        metadata: {
          operation: 'add_member' as const,
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
      description: 'Added member data',
      properties: {
        member: { type: 'object', description: 'Added member object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
