import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskListCommentsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_COMMENT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskListCommentsTool: ToolConfig<ZohoDeskListCommentsParams, ZohoDeskResponse> = {
  id: 'zoho_desk_list_comments',
  name: 'Zoho Desk List Comments',
  description: 'List comments on a Zoho Desk ticket.',
  version: '1.0.0',

  oauth: { required: true, provider: 'zoho-desk' },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Zoho Desk OAuth access token',
    },
    apiDomain: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Zoho Desk data-center REST base URL',
    },
    orgId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Zoho Desk organization ID',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID',
    },
    from: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (0-based)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of comments to return (1-100, default 50)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort by commentedTime. Ascending by default; prefix with - for descending (-commentedTime).',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from !== undefined) query.set('from', String(params.from))
      if (params.limit !== undefined) query.set('limit', String(params.limit))
      if (params.sortBy) query.set('sortBy', params.sortBy)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(requireZohoDeskId(params.ticketId, 'Ticket ID'))}/comments${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to list comments (HTTP ${response.status})`)
      )
    }
    const comments = (Array.isArray(data.data) ? data.data : []).map(withDerivedContentText)
    return {
      success: true,
      output: { comments, count: comments.length },
    }
  },

  outputs: {
    comments: {
      type: 'array',
      description: 'List of comments',
      items: { type: 'object', properties: ZOHO_DESK_COMMENT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of comments returned' },
  },
}
