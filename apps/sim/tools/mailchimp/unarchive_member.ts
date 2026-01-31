import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpMember,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

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
    subscriber_hash: string
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
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Subscriber status: "subscribed", "unsubscribed", "cleaned", "pending", or "transactional"',
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
        subscriber_hash: data.id,
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
        subscriber_hash: { type: 'string', description: 'Subscriber hash' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
