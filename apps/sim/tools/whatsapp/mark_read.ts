import type { ToolConfig } from '@/tools/types'
import type { WhatsAppMarkReadParams, WhatsAppMarkReadResponse } from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  extractWhatsAppErrorMessage,
  parseWhatsAppResponse,
} from '@/tools/whatsapp/utils'

export const markReadTool: ToolConfig<WhatsAppMarkReadParams, WhatsAppMarkReadResponse> = {
  id: 'whatsapp_mark_read',
  name: 'WhatsApp Mark As Read',
  description:
    'Mark a received WhatsApp message as read so the sender sees blue checkmarks, optionally showing a typing indicator.',
  version: '1.0.0',

  params: {
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (wamid) of the incoming message to mark as read',
    },
    showTypingIndicator: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Show a typing indicator to the sender while a reply is composed. Dismissed once you respond or after 25 seconds, whichever comes first.',
    },
    phoneNumberId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WhatsApp Business Phone Number ID (from Meta Business Suite)',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WhatsApp Business API Access Token (from Meta Developer Portal)',
    },
  },

  request: {
    url: (params) => buildMessagesUrl(params.phoneNumberId),
    method: 'POST',
    headers: (params) => buildAuthHeaders(params.accessToken),
    body: (params) => {
      if (!params.messageId) {
        throw new Error('Message ID is required but was not provided')
      }

      const body: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: params.messageId.trim(),
      }
      if (params.showTypingIndicator) {
        body.typing_indicator = { type: 'text' }
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await parseWhatsAppResponse(response)

    if (!response.ok) {
      throw new Error(extractWhatsAppErrorMessage(data, response.status))
    }

    return {
      success: true,
      output: {
        success: data.success !== false,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the message was successfully marked as read',
    },
  },
}
