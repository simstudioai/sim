import type {
  InstagramPrivateReplyParams,
  InstagramPrivateReplyResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError, resolveIgUserId } from '@/tools/instagram/utils'
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
    url: () => graphUrl('/me', { fields: 'user_id' }),
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  postProcess: async (result, params) => {
    if (!result.success) {
      return {
        success: false,
        output: { messageId: null, recipientId: null },
        error: result.error || 'Failed to resolve Instagram account',
      }
    }

    try {
      const igUserId = await resolveIgUserId(params.accessToken, params.igUserId)
      const response = await fetch(graphUrl(`/${igUserId}/messages`), {
        method: 'POST',
        headers: bearerHeaders(params.accessToken),
        body: JSON.stringify({
          recipient: { comment_id: params.commentId.trim() },
          message: { text: params.message },
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          output: { messageId: null, recipientId: null },
          error: await readGraphError(response),
        }
      }

      const data = (await response.json()) as { message_id?: string; recipient_id?: string }
      return {
        success: true,
        output: {
          messageId: data.message_id ?? null,
          recipientId: data.recipient_id ?? null,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: { messageId: null, recipientId: null },
        error: error instanceof Error ? error.message : 'Failed to send private reply',
      }
    }
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { messageId: null, recipientId: null },
        error: `Failed to resolve Instagram account: ${response.statusText}`,
      }
    }
    return { success: true, output: { messageId: null, recipientId: null } }
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
