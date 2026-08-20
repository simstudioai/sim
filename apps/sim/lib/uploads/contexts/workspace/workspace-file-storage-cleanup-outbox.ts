import type { db } from '@sim/db'
import { describeError } from '@sim/utils/errors'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { deleteFile } from '@/lib/uploads/core/storage-service'

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
