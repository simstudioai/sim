import type { ToolConfig } from '@/tools/types'
import type { WhatsAppResponse, WhatsAppSendMessageParams } from '@/tools/whatsapp/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export const sendMessageTool: ToolConfig<WhatsAppSendMessageParams, WhatsAppResponse> = {
  id: 'whatsapp_send_message',
  name: 'WhatsApp Send Message',
  description: 'Send a text message through the WhatsApp Cloud API.',
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
      description: 'Plain text message content to send',
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
    url: (params) => {
      if (!params.phoneNumberId) {
        throw new Error('WhatsApp Phone Number ID is required')
      }
      return `https://graph.facebook.com/v25.0/${params.phoneNumberId.trim()}/messages`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('WhatsApp Access Token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken.trim()}`,
        'Content-Type': 'application/json',
      }
    },
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

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    const parsed = responseText ? (JSON.parse(responseText) as unknown) : {}
    const data = isRecord(parsed) ? parsed : {}
    const error = isRecord(data.error) ? data.error : undefined

    if (!response.ok) {
      const errorMessage =
        (typeof error?.message === 'string' ? error.message : undefined) ||
        (typeof error?.error_user_msg === 'string' ? error.error_user_msg : undefined) ||
        (isRecord(error?.error_data) && typeof error.error_data.details === 'string'
          ? error.error_data.details
          : undefined) ||
        `WhatsApp API error (${response.status})`
      throw new Error(errorMessage)
    }

    const contacts = Array.isArray(data.contacts)
      ? data.contacts.filter(isRecord).map((contact) => ({
          input: typeof contact.input === 'string' ? contact.input : '',
          wa_id: typeof contact.wa_id === 'string' ? contact.wa_id : null,
        }))
      : []
    const firstMessage =
      Array.isArray(data.messages) && isRecord(data.messages[0]) ? data.messages[0] : undefined
    const messageId = typeof firstMessage?.id === 'string' ? firstMessage.id : undefined
    const messageStatus =
      typeof firstMessage?.message_status === 'string' ? firstMessage.message_status : undefined

    if (!messageId) {
      throw new Error('WhatsApp API response did not include a message ID')
    }

    return {
      success: true,
      output: {
        success: true,
        messageId,
        messageStatus,
        messagingProduct:
          typeof data.messaging_product === 'string' ? data.messaging_product : undefined,
        inputPhoneNumber: contacts[0]?.input ?? null,
        whatsappUserId: contacts[0]?.wa_id ?? null,
        contacts,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'WhatsApp message send success status' },
    messageId: { type: 'string', description: 'Unique WhatsApp message identifier' },
    messageStatus: {
      type: 'string',
      description: 'Initial delivery state returned by the API',
      optional: true,
    },
    messagingProduct: {
      type: 'string',
      description: 'Messaging product returned by the API',
      optional: true,
    },
    inputPhoneNumber: {
      type: 'string',
      description: 'Recipient phone number echoed back by WhatsApp',
      optional: true,
    },
    whatsappUserId: {
      type: 'string',
      description: 'WhatsApp user ID resolved for the recipient',
      optional: true,
    },
    contacts: {
      type: 'array',
      description: 'Recipient contact records returned by WhatsApp',
      optional: true,
      items: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input phone number sent to the API' },
          wa_id: {
            type: 'string',
            description: 'WhatsApp user ID associated with the recipient',
            optional: true,
          },
        },
      },
    },
  },
}
