import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpDeleteMember')

export interface MailchimpDeleteMemberParams {
  apiKey: string
  listId: string
  subscriberHash: string
}

export interface MailchimpDeleteMemberResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'delete_member'
      subscriberHash: string
    }
    success: boolean
  }
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
      visibility: 'user-only',
      description: 'The unique ID for the list',
    },
    subscriberHash: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: "The MD5 hash of the lowercase version of the list member's email address",
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(params.apiKey, `/lists/${params.listId}/members/${params.subscriberHash}`),
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
      output: {
        metadata: {
          operation: 'delete_member' as const,
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
      description: 'Deletion confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
