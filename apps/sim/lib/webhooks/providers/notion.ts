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

const logger = createLogger('WebhookProvider:Notion')

/**
 * Validates a Notion webhook signature using HMAC SHA-256.
 * Notion sends X-Notion-Signature as "sha256=<hex>".
 */
function validateNotionSignature(secret: string, signature: string, body: string): boolean {
  try {
    if (!secret || !signature || !body) {
      logger.warn('Notion signature validation missing required fields', {
        hasSecret: !!secret,
        hasSignature: !!signature,
        hasBody: !!body,
      })
      return false
    }

    const providedHash = signature.startsWith('sha256=') ? signature.slice(7) : signature
    const computedHash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')

    logger.debug('Notion signature comparison', {
      computedSignature: `${computedHash.substring(0, 10)}...`,
      providedSignature: `${providedHash.substring(0, 10)}...`,
      computedLength: computedHash.length,
      providedLength: providedHash.length,
      match: computedHash === providedHash,
    })

    return safeCompare(computedHash, providedHash)
  } catch (error) {
    logger.error('Error validating Notion signature:', error)
    return false
  }
}

export const notionHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Notion-Signature',
    validateFn: validateNotionSignature,
    providerLabel: 'Notion',
  }),

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    return {
      input: {
        id: b.id,
        type: b.type,
        timestamp: b.timestamp,
        workspace_id: b.workspace_id,
        workspace_name: b.workspace_name,
        subscription_id: b.subscription_id,
        integration_id: b.integration_id,
        attempt_number: b.attempt_number,
        authors: b.authors || [],
        entity: b.entity || {},
        data: b.data || {},
      },
    }
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId && triggerId !== 'notion_webhook') {
      const { isNotionPayloadMatch } = await import('@/triggers/notion/utils')
      if (!isNotionPayloadMatch(triggerId, obj)) {
        const eventType = obj.type as string | undefined
        logger.debug(
          `[${requestId}] Notion event mismatch for trigger ${triggerId}. Event: ${eventType}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            receivedEvent: eventType,
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
