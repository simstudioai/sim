import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import type {
  AuthContext,
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:TikTok')

/** TikTok recommends rejecting replayed signatures; 5 minutes matches Linear/common practice. */
export const TIKTOK_WEBHOOK_TIMESTAMP_SKEW_SECONDS = 5 * 60

/** Same pattern as auth.ts TikTok accountId suffix strip (`${open_id}-${uuid}`). */
const UUID_SUFFIX_RE = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Strip `${open_id}-${uuid}` → open_id for webhook fan-out matching. */
export function tiktokOpenIdFromAccountId(accountId: string): string {
  return accountId.replace(UUID_SUFFIX_RE, '')
}

export interface TikTokSignatureParts {
  timestamp: string
  signature: string
}

/**
 * Parse `TikTok-Signature: t=<unix>,s=<hex>` (comma-separated prefix=value pairs).
 */
export function parseTikTokSignatureHeader(header: string | null): TikTokSignatureParts | null {
  if (!header) return null

  let timestamp: string | undefined
  let signature: string | undefined

  for (const part of header.split(',')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const prefix = trimmed.slice(0, eq)
    const value = trimmed.slice(eq + 1)
    if (prefix === 't') timestamp = value
    if (prefix === 's') signature = value
  }

  if (!timestamp || !signature) return null
  return { timestamp, signature }
}

/**
 * Verify TikTok webhook HMAC-SHA256 of `${t}.${rawBody}` with the app client secret.
 * Returns null on success, or a 401 NextResponse on failure.
 */
export function verifyTikTokSignature(
  rawBody: string,
  signatureHeader: string | null,
  requestId: string,
  clientSecret: string | undefined = env.TIKTOK_CLIENT_SECRET,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): NextResponse | null {
  if (!clientSecret) {
    logger.warn(`[${requestId}] TikTok webhook missing TIKTOK_CLIENT_SECRET`)
    return new NextResponse('Unauthorized - TikTok client secret not configured', { status: 401 })
  }

  const parts = parseTikTokSignatureHeader(signatureHeader)
  if (!parts) {
    logger.warn(`[${requestId}] TikTok webhook missing or malformed TikTok-Signature header`)
    return new NextResponse('Unauthorized - Missing TikTok signature', { status: 401 })
  }

  const timestampSeconds = Number(parts.timestamp)
  if (!Number.isFinite(timestampSeconds)) {
    logger.warn(`[${requestId}] TikTok webhook signature timestamp is not a number`)
    return new NextResponse('Unauthorized - Invalid TikTok signature timestamp', { status: 401 })
  }

  if (Math.abs(nowSeconds - timestampSeconds) > TIKTOK_WEBHOOK_TIMESTAMP_SKEW_SECONDS) {
    logger.warn(`[${requestId}] TikTok webhook signature timestamp outside allowed skew`, {
      skewSeconds: TIKTOK_WEBHOOK_TIMESTAMP_SKEW_SECONDS,
      timestampSeconds,
      nowSeconds,
    })
    return new NextResponse('Unauthorized - TikTok signature timestamp skew too large', {
      status: 401,
    })
  }

  const signedPayload = `${parts.timestamp}.${rawBody}`
  const computed = hmacSha256Hex(signedPayload, clientSecret)
  if (!safeCompare(computed, parts.signature)) {
    logger.warn(`[${requestId}] TikTok signature verification failed`)
    return new NextResponse('Unauthorized - Invalid TikTok signature', { status: 401 })
  }

  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Parse the TikTok envelope `content` field (a JSON string) into an object.
 */
export function parseTikTokContent(content: unknown): Record<string, unknown> {
  if (typeof content !== 'string' || content.length === 0) {
    return asRecord(content) ?? {}
  }
  try {
    return asRecord(JSON.parse(content)) ?? {}
  } catch {
    logger.warn('Failed to parse TikTok webhook content JSON string')
    return {}
  }
}

function stringField(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

export const tiktokHandler: WebhookProviderHandler = {
  async verifyAuth({ request, rawBody, requestId }: AuthContext): Promise<NextResponse | null> {
    return verifyTikTokSignature(rawBody, request.headers.get('TikTok-Signature'), requestId)
  },

  async matchEvent({ body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) return true

    const { isTikTokEventMatch } = await import('@/triggers/tiktok/utils')
    const obj = body as Record<string, unknown>
    const event = typeof obj.event === 'string' ? obj.event : undefined
    if (!isTikTokEventMatch(triggerId, event)) {
      logger.debug(
        `[${requestId}] TikTok event mismatch for trigger ${triggerId}. Event: ${event}. Skipping.`
      )
      return false
    }
    return true
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const envelope = asRecord(body) ?? {}
    const content = parseTikTokContent(envelope.content)
    const event = typeof envelope.event === 'string' ? envelope.event : ''

    const input: Record<string, unknown> = {
      event,
      createTime: envelope.create_time ?? null,
      userOpenId: typeof envelope.user_openid === 'string' ? envelope.user_openid : '',
      clientKey: typeof envelope.client_key === 'string' ? envelope.client_key : '',
    }

    const publishId = stringField(content, 'publish_id')
    if (publishId) input.publishId = publishId

    const publishType = stringField(content, 'publish_type')
    if (publishType) input.publishType = publishType

    const postId = stringField(content, 'post_id')
    if (postId) input.postId = postId

    const shareId = stringField(content, 'share_id')
    if (shareId) input.shareId = shareId

    if (event === 'post.publish.failed') {
      const failReason = stringField(content, 'fail_reason', 'reason')
      if (failReason) input.failReason = failReason
    }

    if (event === 'authorization.removed') {
      const reason = content.reason
      if (typeof reason === 'number' || typeof reason === 'string') {
        input.reason = reason
      }
    }

    return { input }
  },

  extractIdempotencyId(body: unknown) {
    const envelope = asRecord(body)
    if (!envelope) return null

    const event = typeof envelope.event === 'string' ? envelope.event : null
    const userOpenId = typeof envelope.user_openid === 'string' ? envelope.user_openid : null
    if (!event || !userOpenId) return null

    const content = parseTikTokContent(envelope.content)
    const publishId = stringField(content, 'publish_id')
    const shareId = stringField(content, 'share_id')
    const createTime =
      typeof envelope.create_time === 'number' || typeof envelope.create_time === 'string'
        ? String(envelope.create_time)
        : null

    const unique = publishId ?? shareId ?? createTime
    if (!unique) return null

    return `${event}:${userOpenId}:${unique}`
  },
}
