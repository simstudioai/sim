import type { WhatsAppSendResponse } from '@/tools/whatsapp/types'

/** WhatsApp Cloud API Graph version used by every outbound tool. */
export const WHATSAPP_GRAPH_VERSION = 'v25.0'

/** Build the messages endpoint for a given business phone number ID. */
export function buildMessagesUrl(phoneNumberId: string | undefined): string {
  if (!phoneNumberId) {
    throw new Error('WhatsApp Phone Number ID is required')
  }
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId.trim()}/messages`
}

/** Build the shared Bearer auth headers for the WhatsApp Cloud API. */
export function buildAuthHeaders(accessToken: string | undefined): Record<string, string> {
  if (!accessToken) {
    throw new Error('WhatsApp Access Token is required')
  }
  return {
    Authorization: `Bearer ${accessToken.trim()}`,
    'Content-Type': 'application/json',
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function parseWhatsAppResponse(response: Response): Promise<Record<string, unknown>> {
  const responseText = await response.text()
  const parsed = responseText ? (JSON.parse(responseText) as unknown) : {}
  return isRecord(parsed) ? parsed : {}
}

/** Extract a human-readable error message from a WhatsApp API error payload. */
function extractErrorMessage(data: Record<string, unknown>, status: number): string {
  const error = isRecord(data.error) ? data.error : undefined
  return (
    (typeof error?.message === 'string' ? error.message : undefined) ||
    (typeof error?.error_user_msg === 'string' ? error.error_user_msg : undefined) ||
    (isRecord(error?.error_data) && typeof error.error_data.details === 'string'
      ? error.error_data.details
      : undefined) ||
    `WhatsApp API error (${status})`
  )
}

/**
 * Transform the shared send response shape returned by every outbound message
 * operation (template, media, interactive, reaction) on `/messages`.
 */
export async function transformWhatsAppSendResponse(
  response: Response
): Promise<WhatsAppSendResponse> {
  const data = await parseWhatsAppResponse(response)

  if (!response.ok) {
    throw new Error(extractErrorMessage(data, response.status))
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
}

/**
 * Shared output schema for every outbound send operation. Mirrors the
 * `transformWhatsAppSendResponse` output so each tool stays consistent.
 */
export const whatsappSendOutputs = {
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
} as const
