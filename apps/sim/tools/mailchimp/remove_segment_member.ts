import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpRemoveSegmentMember')

export interface MailchimpRemoveSegmentMemberParams {
  apiKey: string
  listId: string
  segmentId: string
  subscriberHash: string
}

export interface MailchimpRemoveSegmentMemberResponse {
  success: boolean
  output: {
    metadata: {
      operation: 'remove_segment_member'
      subscriberHash: string
    }
    success: boolean
  }
}

export const mailchimpRemoveSegmentMemberTool: ToolConfig<
  MailchimpRemoveSegmentMemberParams,
  MailchimpRemoveSegmentMemberResponse
> = {
  id: 'mailchimp_remove_segment_member',
  name: 'Remove Member from Segment in Mailchimp',
  description: 'Remove a member from a specific segment in a Mailchimp audience',
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
    segmentId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The unique ID for the segment',
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
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/segments/${params.segmentId}/members/${params.subscriberHash}`
      ),
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'remove_segment_member')
    }

    return {
      success: true,
      output: {
        metadata: {
          operation: 'remove_segment_member' as const,
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
      description: 'Removal confirmation',
      properties: {
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
