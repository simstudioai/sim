import { buildMailchimpUrl, handleMailchimpError } from '@/tools/mailchimp/types'
import type { ToolConfig } from '@/tools/types'

export interface MailchimpDeleteMemberParams {
  apiKey: string
  listId: string
  subscriberEmail: string
}

export interface MailchimpDeleteMemberResponse {
  success: boolean
}

export const mailchimpDeleteMemberTool: ToolConfig<
  MailchimpDeleteMemberParams,
  MailchimpDeleteMemberResponse
> = {
  id: 'mailchimp_delete_member',
  name: 'Delete Member from Mailchimp Audience',
  description: 'Delete a member from a Mailchimp audience',
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
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_member')
    }

    return {
      success: true,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the member was successfully deleted' },
  },
}
