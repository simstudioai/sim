import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import { readZohoDeskResponse, ZOHO_DESK_AUTH_PARAMS } from '@/tools/zoho_desk/request'
import type {
  ZohoDeskDeleteCommentParams,
  ZohoDeskDeleteCommentResponse,
} from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskDeleteCommentTool: ToolConfig<
  ZohoDeskDeleteCommentParams,
  ZohoDeskDeleteCommentResponse
> = {
  id: 'zoho_desk_delete_comment',
  name: 'Zoho Desk Delete Comment',
  description: 'Delete Comment in Zoho Desk.',
  version: '1.0.0',
  oauth: { required: true, provider: 'zoho-desk' },
  params: {
    ...ZOHO_DESK_AUTH_PARAMS,
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
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}`
    },
    method: 'DELETE',
    headers: buildZohoDeskHeaders,
  },
  transformResponse: async (response) => {
    if (!response.ok) await readZohoDeskResponse(response)
    return { success: true, output: { completed: true } }
  },
  outputs: {
    completed: {
      type: 'boolean',
      description: 'Whether the requested operation completed successfully',
    },
  },
}
