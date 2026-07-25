import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import {
  assertConnectorSyncPayload,
  type ConnectorSyncPayload,
} from '@/lib/knowledge/connectors/queue'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'

const logger = createLogger('TriggerKnowledgeConnectorSync')

export async function executeConnectorSyncJob(payload: unknown) {
  const { connectorId, fullSync, rehydrate, requestId, billingAttribution } =
    assertConnectorSyncPayload(payload)

  logger.info(`[${requestId}] Starting connector sync: ${connectorId}`)

  try {
    const result = await executeSync(connectorId, { billingAttribution, fullSync, rehydrate })

    logger.info(`[${requestId}] Connector sync completed`, {
      connectorId,
      added: result.docsAdded,
      updated: result.docsUpdated,
      deleted: result.docsDeleted,
      unchanged: result.docsUnchanged,
      failed: result.docsFailed,
    })

    return {
      success: !result.error,
      connectorId,
      ...result,
    }
  } catch (error) {
    logger.error(`[${requestId}] Connector sync failed: ${connectorId}`, error)
    throw error
  }
}

export const knowledgeConnectorSync = task({
  id: 'knowledge-connector-sync',
  maxDuration: 1800,
  machine: 'large-1x',
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
  },
  queue: {
    concurrencyLimit: 5,
    name: 'connector-sync-queue',
  },
  run: async (payload: ConnectorSyncPayload) => executeConnectorSyncJob(payload),
})
