import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { sha256Hex } from '@sim/security/hash'
import { NextResponse } from 'next/server'
import type { AuthContext, EventFilterContext } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProviderAuth')

/**
 * Deterministic JSON serialization with object keys sorted, so structurally
 * identical payloads produce identical output regardless of key order.
 */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

/**
 * Fallback idempotency fingerprint for payloads with no stable delivery id
 * or content timestamp to key on. A provider retry resends identical bytes,
 * so this hash is stable across retries of the same delivery while still
 * differentiating distinct events.
 */
export function buildFallbackDeliveryFingerprint(body: unknown): string {
  return sha256Hex(stableSerialize(body))
}

interface HmacVerifierOptions {
  configKey: string
  headerName: string
  validateFn: (secret: string, signature: string, rawBody: string) => boolean | Promise<boolean>
  providerLabel: string
  /**
   * When true, reject (401) if no secret is configured instead of skipping
   * verification. Use for providers where the secret is always present (e.g.
   * auto-registered webhooks) so a missing secret fails closed.
   */
  requireSecret?: boolean
}

/**
 * Factory that creates a `verifyAuth` implementation for HMAC-signature-based providers.
 * Covers the common pattern: get secret → check header → validate signature → return 401 or null.
 */
export function createHmacVerifier({
  configKey,
  headerName,
  validateFn,
  providerLabel,
  requireSecret = false,
}: HmacVerifierOptions) {
  return async ({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> => {
    const secret = providerConfig[configKey] as string | undefined
    if (!secret) {
      if (requireSecret) {
        logger.warn(`[${requestId}] ${providerLabel} webhook secret not configured`)
        return new NextResponse(`Unauthorized - Missing ${providerLabel} webhook secret`, {
          status: 401,
        })
      }
      return null
    }

    const signature = request.headers.get(headerName)
    if (!signature) {
      logger.warn(`[${requestId}] ${providerLabel} webhook missing signature header`)
      return new NextResponse(`Unauthorized - Missing ${providerLabel} signature`, { status: 401 })
    }

    const isValid = await validateFn(secret, signature, rawBody)
    if (!isValid) {
      logger.warn(`[${requestId}] ${providerLabel} signature verification failed`, {
        signatureLength: signature.length,
        secretLength: secret.length,
      })
      return new NextResponse(`Unauthorized - Invalid ${providerLabel} signature`, { status: 401 })
    }

    return null
  }
}

/**
 * Verify a bearer token or custom header token using timing-safe comparison.
 * Used by generic webhooks, Google Forms, and the default handler.
 */
export function verifyTokenAuth(
  request: Request,
  expectedToken: string,
  secretHeaderName?: string
): boolean {
  if (secretHeaderName) {
    const headerValue = request.headers.get(secretHeaderName.toLowerCase())
    return !!headerValue && safeCompare(headerValue, expectedToken)
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7)
    return safeCompare(token, expectedToken)
  }

  return false
}

/**
 * Skip events whose `body.type` is not in the `providerConfig.eventTypes` allowlist.
 * Shared by providers that use a simple event-type filter (Stripe, Grain, etc.).
 */
export function skipByEventTypes(
  { webhook, body, requestId, providerConfig }: EventFilterContext,
  providerLabel: string,
  eventLogger: Logger
): boolean {
  const eventTypes = providerConfig.eventTypes
  if (!eventTypes || !Array.isArray(eventTypes) || eventTypes.length === 0) {
    return false
  }

  const eventType = (body as Record<string, unknown>)?.type as string | undefined
  if (eventType && !eventTypes.includes(eventType)) {
    eventLogger.info(
      `[${requestId}] ${providerLabel} event type '${eventType}' not in allowed list for webhook ${webhook.id as string}, skipping`
    )
    return true
  }

  return false
}
