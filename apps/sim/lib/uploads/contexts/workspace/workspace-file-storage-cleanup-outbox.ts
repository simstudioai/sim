import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { describeError, getErrorMessage } from '@sim/utils/errors'
import {
  enqueueOutboxEvent,
  enqueueOutboxEvents,
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

/** Enqueues storage deletion in the transaction that removes the corresponding metadata. */
export function enqueueWorkspaceFileStorageCleanup(
  executor: Pick<typeof db, 'insert'>,
  payload: WorkspaceFileStorageCleanupPayload
): Promise<string> {
  return enqueueOutboxEvent(executor, WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT, payload)
}

/** Attempts a newly committed cleanup immediately; the outbox worker retries incomplete work. */
export function processWorkspaceFileStorageCleanupNow(eventId: string) {
  return processOutboxEventById(eventId, workspaceFileStorageCleanupOutboxHandlers)
}

/** Enqueues deletion of several storage objects in one insert, inside the releasing transaction. */
export function enqueueWorkspaceFileStorageCleanups(
  executor: Pick<typeof db, 'insert'>,
  keys: readonly string[]
): Promise<string[]> {
  return enqueueOutboxEvents(
    executor,
    WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
    keys.map((key) => ({ key }))
  )
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
      const result = await processWorkspaceFileStorageCleanupNow(eventId)
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
