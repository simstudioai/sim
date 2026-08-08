import type { ToolConfig } from '@/tools/types'
import type { ZohoDeskAddCommentParams, ZohoDeskResponse } from '@/tools/zoho_desk/types'
import { ZOHO_DESK_COMMENT_PROPERTIES } from '@/tools/zoho_desk/types'
import {
  buildZohoDeskHeaders,
  getZohoDeskApiBase,
  getZohoDeskErrorMessage,
  requireZohoDeskId,
  withDerivedContentText,
} from '@/tools/zoho_desk/utils'

export const zohoDeskAddCommentTool: ToolConfig<ZohoDeskAddCommentParams, ZohoDeskResponse> = {
  id: 'zoho_desk_add_comment',
  name: 'Zoho Desk Add Comment',
  description: 'Add a comment to a Zoho Desk ticket.',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment content',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Content type: plainText or html. Defaults to plainText so agent-written text posts literally; pass 'html' to send markup (Zoho's own API default is html).",
    },
    isPublic: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the comment is public',
    },
  },

  request: {
    url: (params) =>
      `${getZohoDeskApiBase(params)}/tickets/${encodeURIComponent(requireZohoDeskId(params.ticketId, 'Ticket ID'))}/comments`,
    method: 'POST',
    headers: (params) => buildZohoDeskHeaders(params),
    body: (params) => ({
      content: params.content,
      contentType: params.contentType || 'plainText',
      isPublic: params.isPublic ?? false,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        getZohoDeskErrorMessage(data, `Failed to add comment (HTTP ${response.status})`)
      )
    }
    return {
      success: true,
      output: { comment: withDerivedContentText(data) },
    }
  },

  outputs: {
    comment: {
      type: 'object',
      description: 'The created comment',
      properties: ZOHO_DESK_COMMENT_PROPERTIES,
    },
  },
}
