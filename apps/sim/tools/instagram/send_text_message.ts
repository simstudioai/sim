import type {
  InstagramSendTextMessageParams,
  InstagramSendTextMessageResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, readGraphError, resolveIgUserId } from '@/tools/instagram/utils'
import type { ToolConfig } from '@/tools/types'

export const instagramSendTextMessageTool: ToolConfig<
  InstagramSendTextMessageParams,
  InstagramSendTextMessageResponse
> = {
  id: 'instagram_send_text_message',
  name: 'Instagram Send Text Message',
  description:
    'Send a text Direct message. The recipient must have messaged the account first (24h window).',
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
    recipientId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instagram-scoped user id (IGSID) of the recipient',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text (max 1000 bytes UTF-8)',
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
          recipient: { id: params.recipientId.trim() },
          message: { text: params.message },
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          output: { messageId: null, recipientId: params.recipientId.trim() },
          error: await readGraphError(response),
        }
      }

      const data = (await response.json()) as {
        message_id?: string
        recipient_id?: string
      }

      return {
        success: true,
        output: {
          messageId: data.message_id ?? null,
          recipientId: data.recipient_id ?? params.recipientId.trim() ?? null,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: { messageId: null, recipientId: null },
        error: error instanceof Error ? error.message : 'Failed to send message',
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
    recipientId: { type: 'string', description: 'Recipient id', optional: true },
  },
}
