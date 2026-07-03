import type { ToolConfig } from '@/tools/types'
import type { WhatsAppSendReactionParams, WhatsAppSendResponse } from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
  whatsappSendOutputs,
} from '@/tools/whatsapp/utils'

export const sendReactionTool: ToolConfig<WhatsAppSendReactionParams, WhatsAppSendResponse> = {
  id: 'whatsapp_send_reaction',
  name: 'WhatsApp Send Reaction',
  description:
    'React to a WhatsApp message with an emoji. Send an empty emoji to remove an existing reaction.',
  version: '1.0.0',

  params: {
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number with country code (e.g., +14155552671)',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID (wamid) of the message to react to',
    },
    emoji: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emoji to react with. Leave empty to remove an existing reaction.',
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
      if (!params.phoneNumber) {
        throw new Error('Phone number is required but was not provided')
      }
      if (!params.messageId) {
        throw new Error('Message ID is required but was not provided')
      }

      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.phoneNumber.trim(),
        type: 'reaction',
        reaction: {
          message_id: params.messageId.trim(),
          emoji: params.emoji ?? '',
        },
      }
    },
  },

  transformResponse: transformWhatsAppSendResponse,

  outputs: whatsappSendOutputs,
}
