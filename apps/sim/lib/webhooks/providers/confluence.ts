import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import type { EventMatchContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { createHmacVerifier } from '@/lib/webhooks/providers/utils'
import { validateJiraSignature } from '@/lib/webhooks/utils.server'

const logger = createLogger('WebhookProvider:Confluence')

export const confluenceHandler: WebhookProviderHandler = {
  verifyAuth: createHmacVerifier({
    configKey: 'webhookSecret',
    headerName: 'X-Hub-Signature',
    validateFn: validateJiraSignature,
    providerLabel: 'Confluence',
  }),

  async matchEvent({ webhook, workflow, body, requestId, providerConfig }: EventMatchContext) {
    const triggerId = providerConfig.triggerId as string | undefined
    const obj = body as Record<string, unknown>

    if (triggerId) {
      const { isConfluencePayloadMatch } = await import('@/triggers/confluence/utils')
      if (!isConfluencePayloadMatch(triggerId, obj)) {
        logger.debug(
          `[${requestId}] Confluence payload mismatch for trigger ${triggerId}. Skipping execution.`,
          {
            webhookId: webhook.id,
            workflowId: workflow.id,
            triggerId,
            bodyKeys: Object.keys(obj),
          }
        )
        return NextResponse.json({
          message: 'Payload does not match trigger configuration. Ignoring.',
        })
      }
    }

    return true
  },
}
