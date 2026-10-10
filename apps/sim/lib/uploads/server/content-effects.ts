import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { processWorkspaceFileStorageCleanupsNow } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import { processFileLiveDocReconciliationNow } from '@/lib/uploads/server/live-doc-outbox'

const logger = createLogger('FileContentEffects')

/** Reports durable effect failures without changing the outcome of an already committed write. */
export async function finishFileContentEffects(
  effects: { cleanupIds: readonly string[]; liveDocEventId?: string },
  logContext: Record<string, unknown>
): Promise<void> {
  await processWorkspaceFileStorageCleanupsNow(effects.cleanupIds, logContext)
  if (!effects.liveDocEventId) return
  const context = { ...logContext, eventId: effects.liveDocEventId }
  try {
    const result = await processFileLiveDocReconciliationNow(effects.liveDocEventId)
    if (result === 'dead_letter' || result === 'not_found') {
      logger.error('Committed file live-document reconciliation requires intervention', {
        ...context,
        result,
      })
    } else if (result !== 'completed') {
      logger.warn('Live document reconciliation remains pending', { ...context, result })
    }
  } catch (error) {
    logger.error('Committed file live-document reconciliation failed inline', {
      ...context,
      error: describeError(error),
    })
  }
}
