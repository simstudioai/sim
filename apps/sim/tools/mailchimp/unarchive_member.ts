import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpMember } from './types'

const logger = createLogger('MailchimpUnarchiveMember')

export interface MailchimpUnarchiveMemberParams {
  apiKey: string
  listId: string
  subscriberEmail: string
  emailAddress: string
  status: string
}

export interface MailchimpUnarchiveMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    metadata: {
      operation: 'unarchive_member'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpUnarchiveMemberTool: ToolConfig<
  MailchimpUnarchiveMemberParams,
  MailchimpUnarchiveMemberResponse
> = {
  id: 'mailchimp_unarchive_member',
  name: 'Unarchive Member in Mailchimp Audience',
  description: 'Restore an archived member to a Mailchimp audience',
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
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members/${params.subscriberEmail}`),
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      email_address: params.emailAddress,
      status: params.status,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'unarchive_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        metadata: {
          operation: 'unarchive_member' as const,
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
      description: 'Unarchived member data',
      properties: {
        member: { type: 'object', description: 'Unarchived member object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
