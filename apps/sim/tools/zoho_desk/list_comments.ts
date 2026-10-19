import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { readZohoDeskList } from '@/tools/zoho_desk/request'
import type { ZohoDeskListCommentsParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_COMMENT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
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
    commentInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Related data to include: mentions and plainText, comma-separated',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.from != null) query.set('from', String(params.from))
      query.set('limit', String(params.limit ?? 50))
      const include = normalizeZohoDeskCommaList(params.commentInclude)
      if (include) query.set('include', include)
      if (params.sortBy) query.set('sortBy', params.sortBy)
      const qs = query.toString()
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'Ticket ID')}/comments${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => buildZohoDeskHeaders(params),
  },

  transformResponse: async (response) => {
    const { items } = await readZohoDeskList(response)
    const comments = items.map(withDerivedContentText)
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
