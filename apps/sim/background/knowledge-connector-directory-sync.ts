import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import {
  assertDirectorySyncPayload,
  DIRECTORY_SYNC_CONCURRENCY,
  DIRECTORY_SYNC_MAX_DURATION_SECONDS,
  DIRECTORY_SYNC_TASK_ID,
  type DirectorySyncPayload,
} from '@/lib/knowledge/connectors/directory-queue'
import { refreshConnectorDirectory } from '@/lib/knowledge/connectors/external-group-sync'

const logger = createLogger('TriggerKnowledgeConnectorDirectorySync')

export async function executeDirectorySyncJob(payload: unknown) {
  const { connectorId, requestId } = assertDirectorySyncPayload(payload)
  logger.info(`[${requestId}] Starting directory refresh: ${connectorId}`)
  const outcome = await refreshConnectorDirectory(connectorId, requestId)
  logger.info(`[${requestId}] Directory refresh finished`, { connectorId, outcome })
  return { outcome }
}

export const knowledgeConnectorDirectorySync = task({
  id: DIRECTORY_SYNC_TASK_ID,
  maxDuration: DIRECTORY_SYNC_MAX_DURATION_SECONDS,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
  },
  /**
   * Two at a time: a walk is bounded by the provider's rate limit, not by
   * CPU, and one tenant's directory is refreshed by whichever run reaches it
   * first — the rest see it fresh and skip.
   */
  queue: {
    concurrencyLimit: DIRECTORY_SYNC_CONCURRENCY,
    name: 'connector-directory-sync-queue',
  },
  run: async (payload: DirectorySyncPayload) => executeDirectorySyncJob(payload),
})
