import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'

const logger = createLogger('TriggerKnowledgeConnectorSync')

export type ConnectorSyncPayload = {
  connectorId: string
  fullSync?: boolean
  requestId: string
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
  run: async (payload: ConnectorSyncPayload) => {
    const { connectorId, fullSync, requestId } = payload

    logger.info(`[${requestId}] Starting connector sync: ${connectorId}`)

    try {
      const result = await executeSync(connectorId, { fullSync })

      logger.info(`[${requestId}] Connector sync completed`, {
        connectorId,
        added: result.docsAdded,
        updated: result.docsUpdated,
        deleted: result.docsDeleted,
        unchanged: result.docsUnchanged,
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
  },
})
