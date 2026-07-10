import type {
  InstagramSendTextMessageParams,
  InstagramSendTextMessageResponse,
} from '@/tools/instagram/types'
import { bearerHeaders, graphUrl, idString, readGraphError } from '@/tools/instagram/utils'
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
    url: (params) => {
      const path = params.igUserId?.trim() ? `/${params.igUserId.trim()}/messages` : '/me/messages'
      return graphUrl(path)
    },
    method: 'POST',
    headers: (params) => bearerHeaders(params.accessToken),
    body: (params) => ({
      recipient: { id: params.recipientId.trim() },
      message: { text: params.message },
    }),
  },

  transformResponse: async (response, params): Promise<InstagramSendTextMessageResponse> => {
    if (!response.ok) {
      return {
        success: false,
        output: { messageId: null, recipientId: params?.recipientId.trim() ?? null },
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
        recipientId: idString(data.recipient_id) ?? params?.recipientId.trim() ?? null,
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'Sent message id', optional: true },
    recipientId: { type: 'string', description: 'Recipient id', optional: true },
  },
}
