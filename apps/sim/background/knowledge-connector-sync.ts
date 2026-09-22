import { createLogger } from '@sim/logger'
import { AbortTaskRunError, task } from '@trigger.dev/sdk'
import {
  assertConnectorSyncPayload,
  type ConnectorSyncPayload,
} from '@/lib/knowledge/connectors/queue'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { CONNECTOR_SYNC_MAX_DURATION_SECONDS } from '@/lib/knowledge/connectors/sync-limits'
import type { SyncResult } from '@/connectors/types'

const logger = createLogger('TriggerKnowledgeConnectorSync')

export type ConnectorSyncTaskOutcome = 'completed' | 'partial' | 'skipped' | 'failed' | 'deferred'

/**
 * Separates source-sync failures from expected queue/lock no-ops. Intentional
 * source skips do not make a run partial; actual hydration, persistence, or
 * processing-dispatch failures do.
 */
export function classifyConnectorSyncResult(result: SyncResult): ConnectorSyncTaskOutcome {
  if (result.skipReason) return 'skipped'
  if (result.error) return 'failed'
  if (result.deferred && result.docsFailed === 0 && result.processingDispatch.failed === 0)
    return 'deferred'
  if (result.listingIncomplete || result.docsFailed > 0 || result.processingDispatch.failed > 0)
    return 'partial'
  return 'completed'
}

function formatConnectorSyncFailure(
  connectorId: string,
  result: SyncResult,
  outcome: Extract<ConnectorSyncTaskOutcome, 'partial' | 'failed'>
): string {
  if (outcome === 'failed') {
    return `Connector sync failed for ${connectorId}: ${result.error}`
  }
  return `Connector sync partially failed for ${connectorId}: ${result.docsFailed} source failures, ${result.processingDispatch.failed} dispatch failures`
}

export async function executeConnectorSyncJob(payload: unknown) {
  const {
    connectorId,
    fullSync,
    requireRunnable,
    rehydrate,
    requestId,
    billingAttribution,
    dispatchToken,
  } = assertConnectorSyncPayload(payload)

  logger.info(`[${requestId}] Starting connector sync: ${connectorId}`)

  try {
    const result = await executeSync(connectorId, {
      billingAttribution,
      fullSync,
      requireRunnable,
      rehydrate,
      dispatchToken,
    })

    logger.info(`[${requestId}] Connector sync completed`, {
      connectorId,
      outcome: classifyConnectorSyncResult(result),
      deferred: result.deferred,
      added: result.docsAdded,
      updated: result.docsUpdated,
      deleted: result.docsDeleted,
      unchanged: result.docsUnchanged,
      skipped: result.docsSkipped,
      failed: result.docsFailed,
      processingRequested: result.processingDispatch.requested,
      processingAccepted: result.processingDispatch.accepted,
      processingDispatchFailed: result.processingDispatch.failed,
    })

    const outcome = classifyConnectorSyncResult(result)
    if (outcome === 'failed') {
      /**
       * `executeSync` has already persisted its terminal state, and retrying this
       * whole task would duplicate a large fan-out, so fail visibly without
       * retrying the completed transaction. A partial sync is not a failed run:
       * its source failures keep the previous incremental watermark so the next
       * connector pass replays them, its dispatch failures stay eligible for the
       * stuck-document sweep, and the outcome rides on the return value.
       */
      throw new AbortTaskRunError(formatConnectorSyncFailure(connectorId, result, 'failed'))
    }
    if (outcome === 'partial') {
      logger.warn(`[${requestId}] ${formatConnectorSyncFailure(connectorId, result, 'partial')}`)
    }

    return {
      success: outcome === 'completed',
      outcome,
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
  maxDuration: CONNECTOR_SYNC_MAX_DURATION_SECONDS,
  /**
   * Sized from production telemetry: peak sampled RSS 2.6 GB and peak 1.4 vCPU,
   * so `large-1x` holds ~3x memory and ~2.8x CPU headroom. No `outOfMemory`
   * escalation: an OOM is a SIGKILL, so the run never reaches the terminal
   * write that clears `syncLockToken`, and the escalated attempt would find the
   * row still `syncing` and skip. The stale-lock reaper owns that recovery.
   */
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
