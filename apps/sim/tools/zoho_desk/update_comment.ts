import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import {
  buildZohoDeskBody,
  parseZohoDeskJson,
  projectZohoDeskResource,
  readZohoDeskResponse,
  ZOHO_DESK_AUTH_PARAMS,
} from '@/tools/zoho_desk/request'
import type {
  ZohoDeskUpdateCommentParams,
  ZohoDeskUpdateCommentResponse,
} from '@/tools/zoho_desk/types'
import { ZOHO_DESK_COMMENT_PROPERTIES } from '@/tools/zoho_desk/types'
import { buildZohoDeskHeaders, getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const zohoDeskUpdateCommentTool: ToolConfig<
  ZohoDeskUpdateCommentParams,
  ZohoDeskUpdateCommentResponse
> = {
  id: 'zoho_desk_update_comment',
  name: 'Zoho Desk Update Comment',
  description:
    'Update comment content or attachments; visibility can only be set when creating a comment.',
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
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The comment content. To mention an agent: zsu[@user:{zuid}]zsu To mention a team: zsu[@team:{teamId}_{teamName}]zsu Note: This format can also be used to retrieve agent information.',
    },
    attachmentIds: {
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
      required: false,
      visibility: 'user-or-llm',
      description:
        'List of file attachments included in the comment.Note: For more details on attachments, refer to the Uploads section. JSON array.',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Specifies the type of the content whether html or plainText. The default value is html.',
    },
  },
  request: {
    url: (params) => {
      return `${getZohoDeskApiBase(params)}/tickets/${safeUrlPathSegment(params.ticketId, 'ticketId')}/comments/${safeUrlPathSegment(params.commentId, 'commentId')}`
    },
    method: 'PATCH',
    headers: buildZohoDeskHeaders,
    body: (params) => {
      const body = buildZohoDeskBody({
        content: params.content,
        attachmentIds: parseZohoDeskJson(params.attachmentIds, 'attachmentIds', 'array'),
        contentType: params.contentType,
      })
      return body
    },
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
