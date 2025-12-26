import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import type { MailchimpMember } from './types'
import { buildMailchimpUrl, handleMailchimpError } from './types'

const logger = createLogger('MailchimpGetSegmentMembers')

export interface MailchimpGetSegmentMembersParams {
  apiKey: string
  listId: string
  segmentId: string
  count?: string
  offset?: string
}

export interface MailchimpGetSegmentMembersResponse {
  success: boolean
  output: {
    members: MailchimpMember[]
    totalItems: number
    metadata: {
      operation: 'get_segment_members'
      totalReturned: number
    }
    success: boolean
  }
}

export const mailchimpGetSegmentMembersTool: ToolConfig<
  MailchimpGetSegmentMembersParams,
  MailchimpGetSegmentMembersResponse
> = {
  id: 'mailchimp_get_segment_members',
  name: 'Get Segment Members from Mailchimp',
  description: 'Retrieve members of a specific segment from a Mailchimp audience',
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
    count: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results (default: 10, max: 1000)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Number of results to skip',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.count) queryParams.append('count', params.count)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildMailchimpUrl(
        params.apiKey,
        `/lists/${params.listId}/segments/${params.segmentId}/members`
      )
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleMailchimpError(data, response.status, 'get_segment_members')
    }

    const data = await response.json()
    const members = data.members || []

    return {
      success: true,
      output: {
        members,
        totalItems: data.total_items || members.length,
        metadata: {
          operation: 'get_segment_members' as const,
          totalReturned: members.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Segment members data and metadata',
      properties: {
        members: { type: 'array', description: 'Array of member objects' },
        totalItems: { type: 'number', description: 'Total number of members' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
