import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  AuthContext,
  EventFilterContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'

const logger = createLogger('WebhookProvider:MicrosoftTeams')

function validateMicrosoftTeamsSignature(hmacSecret: string, signature: string, body: string): boolean {
  try {
    if (!hmacSecret || !signature || !body) { return false }
    if (!signature.startsWith('HMAC ')) { return false }
    const providedSignature = signature.substring(5)
    const secretBytes = Buffer.from(hmacSecret, 'base64')
    const bodyBytes = Buffer.from(body, 'utf8')
    const computedHash = crypto.createHmac('sha256', secretBytes).update(bodyBytes).digest('base64')
    return safeCompare(computedHash, providedSignature)
  } catch (error) {
    logger.error('Error validating Microsoft Teams signature:', error)
    return false
  }
}

function parseFirstNotification(
  body: unknown
): { subscriptionId: string; messageId: string } | null {
  const obj = body as Record<string, unknown>
  const value = obj.value as unknown[] | undefined
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }

  const notification = value[0] as Record<string, unknown>
  const subscriptionId = notification.subscriptionId as string | undefined
  const resourceData = notification.resourceData as Record<string, unknown> | undefined
  const messageId = resourceData?.id as string | undefined

  if (subscriptionId && messageId) {
    return { subscriptionId, messageId }
  }
  return null
}

export const microsoftTeamsHandler: WebhookProviderHandler = {
  verifyAuth({ request, rawBody, requestId, providerConfig }: AuthContext) {
    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      if (
        !validateMicrosoftTeamsSignature(providerConfig.hmacSecret as string, authHeader, rawBody)
      ) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }
    }

    return null
  },

  formatErrorResponse(error: string, status: number) {
    return NextResponse.json({ type: 'message', text: error }, { status })
  },

  enrichHeaders({ body }: EventFilterContext, headers: Record<string, string>) {
    const parsed = parseFirstNotification(body)
    if (parsed) {
      headers['x-teams-notification-id'] = `${parsed.subscriptionId}:${parsed.messageId}`
    }
  },

  extractIdempotencyId(body: unknown) {
    const parsed = parseFirstNotification(body)
    return parsed ? `${parsed.subscriptionId}:${parsed.messageId}` : null
  },

  formatSuccessResponse(providerConfig: Record<string, unknown>) {
    if (providerConfig.triggerId === 'microsoftteams_chat_subscription') {
      return new NextResponse(null, { status: 202 })
    }

    return NextResponse.json({ type: 'message', text: 'Sim' })
  },

  formatQueueErrorResponse() {
    return NextResponse.json(
      { type: 'message', text: 'Webhook processing failed' },
      { status: 500 }
    )
  },
}
