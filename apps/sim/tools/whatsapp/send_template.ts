import type { ToolConfig } from '@/tools/types'
import type { WhatsAppSendResponse, WhatsAppSendTemplateParams } from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
  whatsappSendOutputs,
} from '@/tools/whatsapp/utils'

function coerceComponents(value: unknown): unknown[] | undefined {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!Array.isArray(parsed)) {
    throw new Error('Template components must be a JSON array')
  }
  return parsed
}

export const sendTemplateTool: ToolConfig<WhatsAppSendTemplateParams, WhatsAppSendResponse> = {
  id: 'whatsapp_send_template',
  name: 'WhatsApp Send Template',
  description:
    'Send a pre-approved WhatsApp template message with a language and optional variable components.',
  version: '1.0.0',

  params: {
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number with country code (e.g., +14155552671)',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the approved message template',
    },
    languageCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Template language/locale code (e.g., en_US)',
    },
    components: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Template components array with parameters for header/body/button variables, per the WhatsApp template message schema',
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
      if (!params.templateName) {
        throw new Error('Template name is required but was not provided')
      }
      if (!params.languageCode) {
        throw new Error('Template language code is required but was not provided')
      }

      const components = coerceComponents(params.components)
      const template: Record<string, unknown> = {
        name: params.templateName.trim(),
        language: { code: params.languageCode.trim() },
      }
      if (components && components.length > 0) {
        template.components = components
      }

      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.phoneNumber.trim(),
        type: 'template',
        template,
      }
    },
  },

  transformResponse: transformWhatsAppSendResponse,

  outputs: whatsappSendOutputs,
}
