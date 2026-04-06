import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { safeCompare } from '@/lib/core/security/encryption'
import type {
  EventMatchContext,
  FormatInputContext,
  FormatInputResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { isGreenhouseEventMatch } from '@/triggers/greenhouse/utils'

const logger = createLogger('WebhookProvider:Greenhouse')

/**
 * Validates the Greenhouse HMAC-SHA256 signature.
 * Greenhouse sends: `Signature: sha256 <hexdigest>`
 */
function validateGreenhouseSignature(secretKey: string, signature: string, body: string): boolean {
  try {
    if (!secretKey || !signature || !body) {
      return false
    }
    const prefix = 'sha256 '
    if (!signature.startsWith(prefix)) {
      return false
    }
    const providedDigest = signature.substring(prefix.length)
    const computedDigest = crypto.createHmac('sha256', secretKey).update(body, 'utf8').digest('hex')
    return safeCompare(computedDigest, providedDigest)
  } catch {
    logger.error('Error validating Greenhouse signature')
    return false
  }
}

export const greenhouseHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'secretKey',
    headerName: 'signature',
    validateFn: validateGreenhouseSignature,
    providerLabel: 'Greenhouse',
  }),

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        action: b.action,
        payload: b.payload || {},
      },
    }
  },

  async matchEvent({ webhook, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const b = body as Record<string, unknown>
    const action = b.action as string | undefined

    if (triggerId && triggerId !== 'greenhouse_webhook') {
      if (!isGreenhouseEventMatch(triggerId, action || '')) {
        logger.debug(
          `[${requestId}] Greenhouse event mismatch for trigger ${triggerId}. Action: ${action}. Skipping execution.`,
          {
            webhookId: webhook.id,
            triggerId,
            receivedAction: action,
          }
        )

        return NextResponse.json({
          message: 'Event type does not match trigger configuration. Ignoring.',
        })
      }
    }

    return true
  },
}
