import type {
  InstagramPrivateReplyParams,
  InstagramPrivateReplyResponse,
} from '@/tools/instagram/types'
import { graphUrl, idString, jsonBearerHeaders, readGraphError } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramPrivateReplyTool: ToolConfig<
  InstagramPrivateReplyParams,
  InstagramPrivateReplyResponse
> = {
  id: 'instagram_private_reply',
  name: 'Instagram Private Reply',
  description: 'Send a private Direct message reply to a commenter (one per commenter)',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'instagram',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Instagram API',
    },
    igUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Instagram professional account user id (defaults to /me)',
    },
    commentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comment id to privately reply to',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Private reply text',
    },
  },

  request: {
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/messages` : '/me/messages'
      return graphUrl(path)
    },
    method: 'POST',
    headers: (params) => jsonBearerHeaders(params.accessToken),
    body: (params) => ({
      recipient: { comment_id: params.commentId.trim() },
      message: { text: params.message },
    }),
  },

  transformResponse: async (response): Promise<InstagramPrivateReplyResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { messageId: null, recipientId: null },
        error: await readGraphError(response),
      }
    }

    const data = (await response.json()) as {
      message_id?: string | number
      recipient_id?: string | number
    }
    return {
      success: true,
      output: {
        messageId: idString(data.message_id),
        recipientId: idString(data.recipient_id),
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'Sent message id', optional: true },
    recipientId: {
      type: 'string',
      description: 'Instagram-scoped recipient id',
      optional: true,
    },
  },
}
