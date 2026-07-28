import type { ToolConfig } from '@/tools/types'
import type { WhatsAppResponse, WhatsAppSendMessageParams } from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
  whatsappSendOutputs,
} from '@/tools/whatsapp/utils'

export const sendMessageTool: ToolConfig<WhatsAppSendMessageParams, WhatsAppResponse> = {
  id: 'whatsapp_send_message',
  name: 'WhatsApp Send Message',
  description:
    'Send a free-form text message through the WhatsApp Cloud API. Only works inside the 24-hour customer service window — use Send Template to start a conversation.',
  version: '1.0.0',

  params: {
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number with country code (e.g., +14155552671)',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Plain text message content to send (max 4096 characters)',
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
    previewUrl: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether WhatsApp should try to render a link preview for the first URL in the message',
    },
  },

  request: {
    url: (params) => buildMessagesUrl(params.phoneNumberId),
    method: 'POST',
    headers: (params) => buildAuthHeaders(params.accessToken),
    body: (params) => {
      if (!params.phoneNumber) {
        throw new Error('Phone number is required but was not provided')
      }

      if (!params.message) {
        throw new Error('Message content is required but was not provided')
      }

      const text: Record<string, boolean | string> = {
        body: params.message,
      }

      if (typeof params.previewUrl === 'boolean') {
        text.preview_url = params.previewUrl
      }

      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.phoneNumber.trim(),
        type: 'text',
        text,
      }
    },
  },

  transformResponse: transformWhatsAppSendResponse,

  outputs: whatsappSendOutputs,
}
