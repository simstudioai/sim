import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { describeError, getErrorMessage } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import {
  enqueueOutboxEvents,
  MAX_BULK_ENQUEUE_EVENTS,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('WorkspaceFileStorageCleanup')

export const WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT = 'workspace-file.storage.cleanup'

interface WorkspaceFileStorageCleanupPayload {
  key: string
}

function parsePayload(payload: unknown): WorkspaceFileStorageCleanupPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Workspace file storage cleanup outbox payload must be an object')
  }
  const key = (payload as Record<string, unknown>).key
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('Workspace file storage cleanup outbox payload is missing key')
  }
  return { key }
}

const cleanupWorkspaceFileStorage: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parsePayload(rawPayload)
  context.signal.throwIfAborted()
  try {
    await deleteFile({ key: payload.key, context: 'workspace' })
  } catch (error) {
    if (describeError(error).code === 'ENOENT') return
    throw error
  }
}

export const workspaceFileStorageCleanupOutboxHandlers = {
  [WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT]: cleanupWorkspaceFileStorage,
} satisfies OutboxHandlerRegistry

/**
 * Enqueues deletion of storage objects inside the transaction that releases them, split into inserts
 * the outbox accepts so a caller can release any number of keys at once.
 */
export async function enqueueWorkspaceFileStorageCleanups(
  executor: Pick<typeof db, 'insert'>,
  keys: readonly string[]
): Promise<string[]> {
  const eventIds: string[] = []
  for (const chunk of chunkArray([...keys], MAX_BULK_ENQUEUE_EVENTS)) {
    eventIds.push(
      ...(await enqueueOutboxEvents(
        executor,
        WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
        chunk.map((key): WorkspaceFileStorageCleanupPayload => ({ key }))
      ))
    )
  }
  return eventIds
}

/**
 * Attempts newly committed cleanups immediately and never throws: a cleanup that cannot finish now
 * stays in the outbox, whose worker retries it, so the caller's committed write is never failed.
 */
export async function processWorkspaceFileStorageCleanupsNow(
  eventIds: readonly string[],
  logContext: Record<string, unknown>
): Promise<void> {
  for (const eventId of eventIds) {
    try {
      const result = await processOutboxEventById(
        eventId,
        workspaceFileStorageCleanupOutboxHandlers
      )
      if (result !== 'completed') {
        logger.warn('Storage cleanup deferred to outbox retry', { ...logContext, eventId, result })
      }
    } catch (error) {
      logger.warn('Storage cleanup deferred after inline processing error', {
        ...logContext,
        eventId,
        error: getErrorMessage(error),
      })
    }
  }
}
