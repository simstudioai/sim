import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type {
  AuthContext,
  EventMatchContext,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'

const logger = createLogger('WebhookProvider:ServiceNow')

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

export const servicenowHandler: WebhookProviderHandler = {
  verifyAuth({ request, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secret = providerConfig.webhookSecret as string | undefined
    if (!secret?.trim()) {
      logger.warn(`[${requestId}] ServiceNow webhook missing webhookSecret — rejecting`)
      return new NextResponse('Unauthorized - Webhook secret not configured', { status: 401 })
    }

    if (
      !verifyTokenAuth(request, secret.trim(), 'x-sim-webhook-secret') &&
      !verifyTokenAuth(request, secret.trim())
    ) {
      logger.warn(`[${requestId}] ServiceNow webhook secret verification failed`)
      return new NextResponse('Unauthorized - Invalid webhook secret', { status: 401 })
    }

    return null
  },

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    if (!triggerId) {
      return true
    }

    const { isServiceNowEventMatch } = await import('@/triggers/servicenow/utils')
    const configuredTableName = providerConfig.tableName as string | undefined
    const obj = asRecord(body)

    if (!isServiceNowEventMatch(triggerId, obj, configuredTableName)) {
      logger.debug(
        `[${requestId}] ServiceNow event mismatch for trigger ${triggerId}. Skipping execution.`,
        { webhookId: webhook.id, workflowId: workflow.id, triggerId }
      )
      return false
    }

    return true
  },
}
