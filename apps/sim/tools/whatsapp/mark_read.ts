import type { ToolConfig } from '@/tools/types'
import type { WhatsAppMarkReadParams, WhatsAppMarkReadResponse } from '@/tools/whatsapp/types'
import { buildAuthHeaders, buildMessagesUrl, isRecord } from '@/tools/whatsapp/utils'

export const markReadTool: ToolConfig<WhatsAppMarkReadParams, WhatsAppMarkReadResponse> = {
  id: 'whatsapp_mark_read',
  name: 'WhatsApp Mark As Read',
  description: 'Mark a received WhatsApp message as read so the sender sees blue checkmarks.',
  version: '1.0.0',

  params: {
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (wamid) of the incoming message to mark as read',
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
      return {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: params.messageId.trim(),
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const parsed = responseText ? (JSON.parse(responseText) as unknown) : {}
    const data = isRecord(parsed) ? parsed : {}
    const error = isRecord(data.error) ? data.error : undefined

    if (!response.ok) {
      const errorMessage =
        (typeof error?.message === 'string' ? error.message : undefined) ||
        (typeof error?.error_user_msg === 'string' ? error.error_user_msg : undefined) ||
        `WhatsApp API error (${response.status})`
      throw new Error(errorMessage)
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
