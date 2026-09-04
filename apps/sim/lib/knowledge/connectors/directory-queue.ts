import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { refreshConnectorDirectory } from '@/lib/knowledge/connectors/external-group-sync'
import { isTriggerAvailable } from '@/lib/knowledge/documents/service'

const logger = createLogger('KnowledgeConnectorDirectoryQueue')

export const DIRECTORY_SYNC_TASK_ID = 'knowledge-connector-directory-sync'

export interface DirectorySyncPayload {
  connectorId: string
  requestId: string
}

export function assertDirectorySyncPayload(value: unknown): DirectorySyncPayload {
  if (!isRecordLike(value)) throw new Error('Directory sync payload must be an object')
  const { connectorId, requestId } = value
  if (typeof connectorId !== 'string' || connectorId.length === 0) {
    throw new Error('Directory sync payload requires a connector ID')
  }
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Directory sync payload requires a request ID')
  }
  return { connectorId, requestId }
}

/**
 * Hands a connector's directory refresh to the background, the way the
 * content and member schedulers hand off their runs.
 *
 * A directory walk is one Admin SDK call per group and can run for minutes on
 * a large domain, which is longer than any scheduler's request lives: done
 * inline, the cron wrapper's timeout would retry a request that was still
 * running and stack walks of the same directory. The tick's own time is the
 * idempotency key, so a wrapper retry within one tick dispatches nothing new.
 * Without Trigger.dev the refresh runs in-process and the request returns
 * without waiting for it.
 */
export async function dispatchDirectorySync(
  connectorId: string,
  options: { requestId?: string; tickAt: Date }
): Promise<void> {
  const payload: DirectorySyncPayload = {
    connectorId,
    requestId: options.requestId ?? generateId(),
  }

  if (isTriggerAvailable()) {
    const idempotencyKey = await idempotencyKeys.create(
      `${DIRECTORY_SYNC_TASK_ID}:${connectorId}:${options.tickAt.toISOString()}`,
      { scope: 'global' }
    )
    await tasks.trigger(DIRECTORY_SYNC_TASK_ID, payload, {
      idempotencyKey,
      tags: [`connector:${connectorId}`],
      region: await resolveTriggerRegion(),
    })
    return
  }

  refreshConnectorDirectory(payload.connectorId, payload.requestId).catch((error) => {
    logger.error('Directory refresh failed', {
      connectorId,
      requestId: payload.requestId,
      error: getErrorMessage(error),
    })
  })
}
