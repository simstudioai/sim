import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { WhatsAppToolResponse } from './types'

const logger = createLogger('WhatsApp Send Message Tool')

export const sendMessageTool: ToolConfig<any, WhatsAppToolResponse> = {
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
      requiredForToolCall: true,
    },
  },

  request: {
    url: (params) => {
      if (!params.phoneNumberId) {
        throw new Error('WhatsApp Phone Number ID is required')
      }
      return `https://graph.facebook.com/v22.0/${params.phoneNumberId}/messages`
    },
    method: 'POST',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('WhatsApp Access Token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Check if required parameters exist
      if (!params.phoneNumber) {
        throw new Error('Phone number is required but was not provided')
      }

      if (!params.message) {
        throw new Error('Message content is required but was not provided')
      }

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
      const errorMessage =
        data.error?.message || `Failed to send WhatsApp message (HTTP ${response.status})`
      logger.error('WhatsApp API error:', data)
      throw new Error(errorMessage)
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
    logger.error('WhatsApp tool error:', { error })
    return `WhatsApp message failed: ${error.message || 'Unknown error occurred'}`
  },
}
