import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { buildMailchimpUrl, handleMailchimpError, type MailchimpMember } from './types'

const logger = createLogger('MailchimpAddSegmentMember')

export interface MailchimpAddSegmentMemberParams {
  apiKey: string
  listId: string
  segmentId: string
  emailAddress: string
}

export interface MailchimpAddSegmentMemberResponse {
  success: boolean
  output: {
    member: MailchimpMember
    metadata: {
      operation: 'add_segment_member'
      segmentId: string
    }
    success: boolean
  }
}

export const mailchimpAddSegmentMemberTool: ToolConfig<
  MailchimpAddSegmentMemberParams,
  MailchimpAddSegmentMemberResponse
> = {
  id: 'mailchimp_add_segment_member',
  name: 'Add Member to Segment in Mailchimp',
  description: 'Add a member to a specific segment in a Mailchimp audience',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Email address of the member',
    },
  },

  request: {
    url: (params) =>
      buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/segments/${params.segmentId}/members`
      ),
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      email_address: params.emailAddress,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'add_segment_member')
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        member: data,
        metadata: {
          operation: 'add_segment_member' as const,
          segmentId: '',
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
