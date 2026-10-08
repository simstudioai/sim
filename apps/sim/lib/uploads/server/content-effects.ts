import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { processWorkspaceFileStorageCleanupsNow } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { processFileLiveDocReconciliationNow } from '@/lib/uploads/server/live-doc-outbox'

const logger = createLogger('FileContentEffects')

/** Processes durable content effects after commit, retaining the caller's inline failure policy. */
export async function finishFileContentEffects(
  effects: { cleanupIds: readonly string[]; liveDocEventId?: string },
  logContext: Record<string, unknown>,
  reconciliationFailure: 'propagate' | 'defer' = 'propagate'
): Promise<void> {
  await processWorkspaceFileStorageCleanupsNow(effects.cleanupIds, logContext)
  if (!effects.liveDocEventId) return
  if (reconciliationFailure === 'propagate') {
    await processFileLiveDocReconciliationNow(effects.liveDocEventId)
    return
  }
  const context = { ...logContext, eventId: effects.liveDocEventId }
  try {
    const result = await processFileLiveDocReconciliationNow(effects.liveDocEventId)
    if (result !== 'completed') {
      logger.warn('Live document reconciliation deferred to outbox retry', { ...context, result })
    }
  } catch (error) {
    logger.warn('Live document reconciliation deferred after inline processing error', {
      ...context,
      error: describeError(error),
    })
  }
}
