import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { NextResponse } from 'next/server'
import type { AuthContext, EventFilterContext } from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProviderAuth')

interface HmacVerifierOptions {
  configKey: string
  headerName: string
  validateFn: (secret: string, signature: string, rawBody: string) => boolean | Promise<boolean>
  providerLabel: string
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
}: HmacVerifierOptions) {
  return async ({
    request,
    rawBody,
    requestId,
    providerConfig,
  }: AuthContext): Promise<NextResponse | null> => {
    const secret = providerConfig[configKey] as string | undefined
    if (!secret) {
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
