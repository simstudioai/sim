import {
  buildMailchimpUrl,
  handleMailchimpError,
  mailchimpMemberSegment,
} from '@/tools/mailchimp/types'
import { MAILCHIMP_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export interface MailchimpDeleteMemberPermanentParams {
  apiKey: string
  listId: string
  subscriberEmail: string
}

export interface MailchimpDeleteMemberPermanentResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpDeleteMemberPermanentTool: ToolConfig<
  MailchimpDeleteMemberPermanentParams,
  MailchimpDeleteMemberPermanentResponse
> = {
  id: 'mailchimp_delete_member_permanent',
  name: 'Permanently Delete Member from Mailchimp Audience',
  description:
    'Permanently delete a member and their personally identifiable data from a Mailchimp audience. This cannot be undone, and the address cannot be re-imported.',
  version: '1.0.0',
  oauth: MAILCHIMP_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
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
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${safeUrlPathSegment(params.listId, 'listId')}/members/${mailchimpMemberSegment(params.subscriberEmail)}/actions/delete-permanent`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'delete_member_permanent')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Permanent deletion confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
