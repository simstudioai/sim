import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import {
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type { ZohoDeskGetCommentParams, ZohoDeskGetCommentResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_COMMENT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  normalizeZohoDeskCommaList,
} from '@/tools/zoho_desk/utils'

export const zohoDeskGetCommentTool: ToolConfig<
  ZohoDeskGetCommentParams,
  ZohoDeskGetCommentResponse
> = {
  id: 'zoho_desk_get_comment',
  name: 'Zoho Desk Get Comment',
  description: 'Get Comment in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
    commentInclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Related comment data to include: mentions, plainText, or both separated by commas.',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment ID',
    },
    ticketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticket ID',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.commentInclude != null && params.commentInclude !== '') {
        const value = normalizeZohoDeskCommaList(params.commentInclude)
        if (value !== undefined) query.set('include', String(value))
      }
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}${query.size ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response) => {
    const data = await readZohoDeskResponse(response)
    return {
      success: true,
      output: { comment: projectZohoDeskResource(data, ZOHO_DESK_COMMENT_PROPERTIES) },
    }
  },
  outputs: {
    comment: {
      type: 'object',
      description: 'The comment',
      properties: ZOHO_DESK_COMMENT_PROPERTIES,
    },
  },
}
