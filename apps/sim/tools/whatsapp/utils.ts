import type { WhatsAppMediaType, WhatsAppSendResponse } from '@/tools/whatsapp/types'

/** WhatsApp Cloud API Graph version used by every outbound tool. */
export const WHATSAPP_GRAPH_VERSION = 'v25.0'

/** Build the messages endpoint for a given business phone number ID. */
export function buildMessagesUrl(phoneNumberId: string | undefined): string {
  if (!phoneNumberId) {
    throw new Error('WhatsApp Phone Number ID is required')
  }
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId.trim()}/messages`
}

/** Build the media upload endpoint for a given business phone number ID. */
export function buildMediaUploadUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId.trim())}/media`
}

/** Build the media metadata endpoint for a media ID, optionally scoped to a phone number. */
export function buildMediaUrl(mediaId: string, phoneNumberId?: string): string {
  const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(mediaId.trim())}`
  return phoneNumberId
    ? `${base}?phone_number_id=${encodeURIComponent(phoneNumberId.trim())}`
    : base
}

/**
 * Per-type upload ceilings documented in the WhatsApp Cloud API media reference.
 * Enforced before any bytes leave Sim so oversized files fail with an actionable
 * message instead of WhatsApp's generic error 131052.
 */
const WHATSAPP_MEDIA_LIMITS = [
  { prefix: 'image/', maxBytes: 5 * 1024 * 1024, label: 'Images (5 MB)' },
  { prefix: 'video/', maxBytes: 16 * 1024 * 1024, label: 'Videos (16 MB)' },
  { prefix: 'audio/', maxBytes: 16 * 1024 * 1024, label: 'Audio (16 MB)' },
] as const

/** Stickers are `image/webp` but carry a far tighter cap than other images. */
const WHATSAPP_STICKER_MAX_BYTES = 500 * 1024

/** Documents carry the largest documented ceiling, so it doubles as the overall cap. */
export const WHATSAPP_MEDIA_MAX_BYTES = 100 * 1024 * 1024

/**
 * Resolve the documented upload ceiling for a MIME type. Unknown types fall back to
 * the 100 MB document ceiling, which is also the largest WhatsApp accepts.
 */
export function whatsappMediaLimitFor(mimeType: string): { maxBytes: number; label: string } {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/webp') {
    return { maxBytes: WHATSAPP_STICKER_MAX_BYTES, label: 'Stickers (500 KB)' }
  }
  const match = WHATSAPP_MEDIA_LIMITS.find((limit) => normalized.startsWith(limit.prefix))
  return match ?? { maxBytes: WHATSAPP_MEDIA_MAX_BYTES, label: 'Documents (100 MB)' }
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

export async function parseWhatsAppResponse(response: Response): Promise<Record<string, unknown>> {
  const responseText = await response.text()
  const parsed = responseText ? (JSON.parse(responseText) as unknown) : {}
  return isRecord(parsed) ? parsed : {}
}

/**
 * Extract a human-readable error message from a WhatsApp API error payload.
 *
 * The Cloud API error envelope is `{ error: { message, type, code, error_subcode,
 * error_data: { details }, fbtrace_id } }`. `error_data.details` usually carries the
 * actionable explanation while `message` carries the summary, so both are surfaced,
 * along with the numeric `code` that the error-code reference is keyed on.
 */
export function extractWhatsAppErrorMessage(data: Record<string, unknown>, status: number): string {
  const error = isRecord(data.error) ? data.error : undefined
  const summary = typeof error?.message === 'string' ? error.message : undefined
  const details =
    isRecord(error?.error_data) && typeof error.error_data.details === 'string'
      ? error.error_data.details
      : undefined
  const code = typeof error?.code === 'number' ? error.code : undefined

  const base = [summary, details].filter(Boolean).join(' — ') || `WhatsApp API error (${status})`
  return code === undefined || base.includes(`${code}`) ? base : `${base} (code ${code})`
}

export const WHATSAPP_MEDIA_TYPES = [
  'image',
  'document',
  'video',
  'audio',
  'sticker',
] as const satisfies readonly WhatsAppMediaType[]

/** Audio and sticker messages have no `caption` field; only documents accept `filename`. */
const CAPTION_TYPES: ReadonlySet<WhatsAppMediaType> = new Set(['image', 'video', 'document'])

interface MediaMessageInput {
  phoneNumber?: string
  mediaType?: string
  mediaId?: string
  mediaLink?: string
  caption?: string
  filename?: string
}

/**
 * Build the `/messages` body for a media send. Exactly one of `mediaId` or `mediaLink`
 * must be set — the Cloud API treats `id` and `link` as mutually exclusive.
 */
export function buildMediaMessageBody(params: MediaMessageInput): Record<string, unknown> {
  if (!params.phoneNumber) {
    throw new Error('Phone number is required but was not provided')
  }

  const mediaType = params.mediaType?.trim() as WhatsAppMediaType
  if (!WHATSAPP_MEDIA_TYPES.includes(mediaType)) {
    throw new Error(`Media type must be one of: ${WHATSAPP_MEDIA_TYPES.join(', ')}`)
  }

  const link = params.mediaLink?.trim()
  const id = params.mediaId?.trim()
  if (!link && !id) {
    throw new Error('Either a file, a media ID, or a media link is required')
  }
  if (link && id) {
    throw new Error('Provide either a media ID or a media link, not both')
  }

  const media: Record<string, string> = id ? { id } : { link: link as string }
  if (params.caption && CAPTION_TYPES.has(mediaType)) {
    media.caption = params.caption
  }
  if (params.filename && mediaType === 'document') {
    media.filename = params.filename
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.phoneNumber.trim(),
    type: mediaType,
    [mediaType]: media,
  }
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
    throw new Error(extractWhatsAppErrorMessage(data, response.status))
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
    description:
      'Message pacing status when WhatsApp returns one: accepted, held_for_quality_assessment, or paused. Acceptance is not delivery — subscribe to the webhook trigger for delivery status.',
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
