import { createLogger } from '@sim/logger'
import type { FormatInputContext, WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { fetchAndProcessAirtablePayloads } from '@/lib/webhooks/utils.server'

const logger = createLogger('WebhookProvider:Airtable')

export const airtableHandler: WebhookProviderHandler = {
  extractIdempotencyId(body: unknown) {
    const obj = body as Record<string, unknown>
    if (typeof obj.cursor === 'string') {
      return obj.cursor
    }
    return null
  },

  async formatInput({ webhook, workflow, requestId }: FormatInputContext) {
    logger.info(`[${requestId}] Processing Airtable webhook via fetchAndProcessAirtablePayloads`)

    const webhookData = {
      id: webhook.id,
      provider: webhook.provider,
      providerConfig: webhook.providerConfig,
    }

    const mockWorkflow = {
      id: workflow.id,
      userId: workflow.userId,
    }

    const airtableInput = await fetchAndProcessAirtablePayloads(
      webhookData,
      mockWorkflow,
      requestId
    )

    if (airtableInput) {
      logger.info(`[${requestId}] Executing workflow with Airtable changes`)
      return { input: airtableInput }
    }

    logger.info(`[${requestId}] No Airtable changes to process`)
    return { input: null, skip: { message: 'No Airtable changes to process' } }
  },
}
