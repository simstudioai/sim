import {
  buildMailchimpUrl,
  buildMemberTags,
  handleMailchimpError,
  mailchimpMemberSegment,
} from '@/tools/mailchimp/types'
import { MAILCHIMP_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export interface MailchimpAddMemberTagsParams {
  apiKey: string
  listId: string
  subscriberEmail: string
  tags: string
}

export interface MailchimpAddMemberTagsResponse {
  success: boolean
  output: {
    success: boolean
  }
}

export const mailchimpAddMemberTagsTool: ToolConfig<
  MailchimpAddMemberTagsParams,
  MailchimpAddMemberTagsResponse
> = {
  id: 'mailchimp_add_member_tags',
  name: 'Add Tags to Member in Mailchimp',
  description: 'Add tags to a member in a Mailchimp audience',
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
    tags: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of tag objects (e.g., [{"name": "VIP", "status": "active"}]) or a comma-separated list of tag names; status defaults to "active"',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${safeUrlPathSegment(params.listId, 'listId')}/members/${mailchimpMemberSegment(params.subscriberEmail)}/tags`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ tags: buildMemberTags(params.tags, 'active') }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'add_member_tags')
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
      description: 'Tag addition confirmation',
      properties: {
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
