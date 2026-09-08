import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { PASTE_LIMITS } from '@sim/utils/paste'
import { and, eq, isNull } from 'drizzle-orm'
import {
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { applyEditToLiveFileDoc, invalidateLiveFileDoc } from '@/lib/realtime/notify'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'

export const WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT = 'workspace-file.live-doc.reconcile'

interface WorkspaceFileLiveDocPayload {
  workspaceId: string
  fileId: string
  version: number
}

function parsePayload(payload: unknown): WorkspaceFileLiveDocPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Workspace file live-document outbox payload must be an object')
  }
  const candidate = payload as Partial<WorkspaceFileLiveDocPayload>
  if (typeof candidate.workspaceId !== 'string' || candidate.workspaceId.length === 0) {
    throw new Error('Workspace file live-document outbox payload is missing workspaceId')
  }
  if (typeof candidate.fileId !== 'string' || candidate.fileId.length === 0) {
    throw new Error('Workspace file live-document outbox payload is missing fileId')
  }
  if (
    typeof candidate.version !== 'number' ||
    !Number.isSafeInteger(candidate.version) ||
    candidate.version <= 0
  ) {
    throw new Error('Workspace file live-document outbox payload has an invalid version')
  }
  return candidate as WorkspaceFileLiveDocPayload
}

const reconcileWorkspaceFileLiveDoc: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parsePayload(rawPayload)
  context.signal.throwIfAborted()
  const [file] = await db
    .select({
      key: workspaceFiles.key,
      name: workspaceFiles.originalName,
      type: workspaceFiles.contentType,
      sizeBytes: workspaceFiles.sizeBytes,
      contentUpdatedAt: workspaceFiles.contentUpdatedAt,
    })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, payload.fileId),
        eq(workspaceFiles.workspaceId, payload.workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (!file) return
  const currentVersion = file.contentUpdatedAt.getTime()
  if (currentVersion < payload.version) {
    throw new Error('Workspace file live-document reconciliation is ahead of durable content')
  }
  if (
    !isMarkdownFile(file) ||
    file.sizeBytes === null ||
    file.sizeBytes > PASTE_LIMITS.RICH_MARKDOWN_BYTES
  ) {
    /** Later binary writes do not enqueue reconciliation, so retire the latest unsupported version. */
    await invalidateLiveFileDoc(payload.fileId, currentVersion, context.signal)
    return
  }
  if (currentVersion > payload.version) return

  const content = await downloadFile({
    key: file.key,
    context: 'workspace',
    maxBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
    signal: context.signal,
  })
  context.signal.throwIfAborted()
  const result = await applyEditToLiveFileDoc(
    payload.fileId,
    content.toString('utf-8'),
    { version: payload.version },
    context.signal
  )
  if (result.status === 'merge-unavailable') {
    return deferOutboxHandler('Live document merge slot is temporarily unavailable')
  }
}

export const workspaceFileLiveDocOutboxHandlers = {
  [WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT]: reconcileWorkspaceFileLiveDoc,
} satisfies OutboxHandlerRegistry

/** Enqueues live-document reconciliation in the same transaction as the durable file version. */
export function enqueueWorkspaceFileLiveDocReconciliation(
  executor: Pick<typeof db, 'insert'>,
  payload: WorkspaceFileLiveDocPayload
): Promise<string> {
  return enqueueOutboxEvent(executor, WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT, payload)
}

/** Attempts a newly committed reconciliation immediately; the outbox worker owns retries. */
export function processWorkspaceFileLiveDocReconciliationNow(eventId: string) {
  return processOutboxEventById(eventId, workspaceFileLiveDocOutboxHandlers)
}
