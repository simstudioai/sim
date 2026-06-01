import type { LinqServiceType, LinqWebhookSubscription } from '@/tools/linq/types'

/** Base URL for the Linq partner API. Operation paths are appended under `/v3`. */
export const LINQ_API_BASE = 'https://api.linqapp.com/api/partner/v3'

/** Authorization headers shared by every Linq request. */
export function linqHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/** Extract a human-readable error message from a Linq error response body. */
export function extractLinqError(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const error = record.error
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message
      if (typeof message === 'string' && message.length > 0) return message
    }
    if (typeof record.message === 'string' && record.message.length > 0) return record.message
  }
  return fallback
}

interface MessageContentInput {
  text?: string
  mediaUrl?: string
  attachmentId?: string
  linkUrl?: string
  preferredService?: LinqServiceType
  effectName?: string
  effectType?: string
  replyToMessageId?: string
  replyToPartIndex?: number
  idempotencyKey?: string
}

/**
 * Build the `message` content object sent to chat create/send endpoints.
 * Assembles the `parts` array from text, media, and link inputs, then layers
 * on optional effect, reply, service preference, and idempotency fields.
 */
export function buildMessageContent(input: MessageContentInput): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = []

  if (input.linkUrl) {
    // Linq requires a link to be the only part in a message — it cannot be
    // combined with text or media parts — so a link is sent on its own.
    parts.push({ type: 'link', value: input.linkUrl })
  } else {
    if (input.text && input.text.length > 0) {
      parts.push({ type: 'text', value: input.text })
    }
    if (input.attachmentId) {
      parts.push({ type: 'media', attachment_id: input.attachmentId })
    } else if (input.mediaUrl) {
      parts.push({ type: 'media', url: input.mediaUrl })
    }
  }

  if (parts.length === 0) {
    throw new Error('A message requires text, a media URL, an attachment ID, or a link URL')
  }

  const message: Record<string, unknown> = { parts }

  if (input.preferredService) {
    message.preferred_service = input.preferredService
  }
  if (input.effectName || input.effectType) {
    const effect: Record<string, unknown> = {}
    if (input.effectName) effect.name = input.effectName
    if (input.effectType) effect.type = input.effectType
    message.effect = effect
  }
  if (input.replyToMessageId) {
    const replyTo: Record<string, unknown> = { message_id: input.replyToMessageId }
    if (typeof input.replyToPartIndex === 'number') replyTo.part_index = input.replyToPartIndex
    message.reply_to = replyTo
  }
  if (input.idempotencyKey) {
    message.idempotency_key = input.idempotencyKey
  }

  return message
}

/** Map a raw webhook subscription API object to the camelCase output shape. */
export function mapWebhookSubscription(data: Record<string, unknown>): LinqWebhookSubscription {
  return {
    id: (data.id as string) ?? '',
    targetUrl: (data.target_url as string) ?? '',
    subscribedEvents: (data.subscribed_events as string[]) ?? [],
    phoneNumbers: (data.phone_numbers as string[] | null) ?? null,
    isActive: (data.is_active as boolean) ?? false,
    createdAt: (data.created_at as string | null) ?? null,
    updatedAt: (data.updated_at as string | null) ?? null,
  }
}
