import type { ToolConfig } from '@/tools/types'
import type { WhatsAppSendInteractiveParams, WhatsAppSendResponse } from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
  whatsappSendOutputs,
} from '@/tools/whatsapp/utils'

function coerceArray(value: unknown): unknown[] | undefined {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!Array.isArray(parsed)) {
    throw new Error('Interactive buttons and sections must be JSON arrays')
  }
  return parsed.length > 0 ? parsed : undefined
}

export const sendInteractiveTool: ToolConfig<WhatsAppSendInteractiveParams, WhatsAppSendResponse> =
  {
    id: 'whatsapp_send_interactive',
    name: 'WhatsApp Send Interactive',
    description: 'Send an interactive WhatsApp message with reply buttons or a selectable list.',
    version: '1.0.0',

    params: {
      phoneNumber: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Recipient phone number with country code (e.g., +14155552671)',
      },
      bodyText: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Main body text of the interactive message',
      },
      headerText: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional plain-text header shown above the body',
      },
      footerText: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional footer text shown below the body',
      },
      buttons: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Reply buttons array (max 3), each item: { "type": "reply", "reply": { "id": "...", "title": "..." } }. Provide buttons or sections.',
      },
      listButtonText: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Label for the menu button that opens the list (required when sending a list)',
      },
      sections: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'List sections array, each item: { "title": "...", "rows": [{ "id": "...", "title": "...", "description": "..." }] }. Provide sections or buttons.',
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
        if (!params.bodyText) {
          throw new Error('Body text is required but was not provided')
        }

        const buttons = coerceArray(params.buttons)
        const sections = coerceArray(params.sections)
        if (!buttons && !sections) {
          throw new Error('Provide either buttons (reply buttons) or sections (list)')
        }
        if (buttons && sections) {
          throw new Error('Provide either buttons or sections, not both')
        }

        const interactive: Record<string, unknown> = {
          type: buttons ? 'button' : 'list',
          body: { text: params.bodyText },
        }
        if (params.headerText) {
          interactive.header = { type: 'text', text: params.headerText }
        }
        if (params.footerText) {
          interactive.footer = { text: params.footerText }
        }
        if (buttons) {
          interactive.action = { buttons }
        } else {
          const listButton = params.listButtonText?.trim()
          if (!listButton) {
            throw new Error('listButtonText is required when sending a list')
          }
          interactive.action = { button: listButton, sections }
        }

        return {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.phoneNumber.trim(),
          type: 'interactive',
          interactive,
        }
      },
    },

    transformResponse: transformWhatsAppSendResponse,

    outputs: whatsappSendOutputs,
  }
