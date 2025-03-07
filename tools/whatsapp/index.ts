import { ToolConfig } from '../types'
import { WhatsAppToolResponse } from './types'

export const WhatsAppTool: ToolConfig<any, WhatsAppToolResponse> = {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  version: '1.0.0',

  params: {
    phoneNumber: {
      type: 'string',
      required: true,
      description: 'Recipient phone number with country code',
    },
    message: {
      type: 'string',
      required: true,
      description: 'Message content to send',
    },
    phoneNumberId: {
      type: 'string',
      required: true,
      description: 'WhatsApp Business Phone Number ID',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'WhatsApp Business API Access Token',
    },
  },

  request: {
    url: (params) => `https://graph.facebook.com/v18.0/${params.phoneNumberId}/messages`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Format the phone number (remove + if present)
      const formattedPhoneNumber = params.phoneNumber.startsWith('+')
        ? params.phoneNumber.substring(1)
        : params.phoneNumber

      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhoneNumber,
        type: 'text',
        text: {
          body: params.message,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to send WhatsApp message')
    }

    return {
      success: true,
      output: {
        success: true,
        messageId: data.messages?.[0]?.id,
      },
      error: undefined,
    }
  },

  transformError: (error) => {
    return error.message || 'Unknown error occurred'
  },
}
