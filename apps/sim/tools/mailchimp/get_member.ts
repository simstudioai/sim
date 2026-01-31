import {
  buildMailchimpUrl,
  handleMailchimpError,
  type MailchimpMember,
} from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpGetMemberParams {
  apiKey: string
  listId: string
  subscriberEmail: string
}

export interface MailchimpGetMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    subscriber_hash: string
  }
}

export const mailchimpGetMemberTool: ToolConfig<
  MailchimpGetMemberParams,
  MailchimpGetMemberResponse
> = {
  id: 'mailchimp_get_member',
  name: 'Get Member from Mailchimp Audience',
  description: 'Retrieve details of a specific member from a Mailchimp audience',
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
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members/${params.subscriberEmail}`),
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        subscriber_hash: data.id,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the member was successfully retrieved' },
    output: {
      type: 'object',
      description: 'Member data',
      properties: {
        member: { type: 'json', description: 'Member object' },
        subscriber_hash: {
          type: 'string',
          description: 'The MD5 hash of the member email address',
        },
      },
    },
  },
}
