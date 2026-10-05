import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { parseFileDocTarget } from '@sim/realtime-protocol/file-doc-target'
import { isRecordLike } from '@sim/utils/object'
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
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

export const FILE_LIVE_DOC_OUTBOX_EVENT = 'workspace-file.live-doc.reconcile'

type FileLiveDocPayload = { fileId: string; version: number } & (
  | { workspaceId: string; owner?: never }
  | { owner: EditableFileOwner; workspaceId?: never }
)

interface ParsedLiveDocPayload {
  fileId: string
  version: number
  owner: EditableFileOwner
}

function parsePayload(payload: unknown): ParsedLiveDocPayload {
  if (!isRecordLike(payload)) {
    throw new Error('Workspace file live-document outbox payload must be an object')
  }
  const candidate = payload as Partial<FileLiveDocPayload>
  let owner: EditableFileOwner
  if (candidate.owner !== undefined) {
    const target = parseFileDocTarget(candidate)
    if (candidate.workspaceId !== undefined || !target?.owner)
      throw new Error('Invalid live-document owner')
    owner = target.owner
  } else {
    if (typeof candidate.workspaceId !== 'string' || !candidate.workspaceId)
      throw new Error('Workspace file live-document outbox payload is missing workspaceId')
    owner = { entityType: 'workspace', entityId: candidate.workspaceId }
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
  return { fileId: candidate.fileId, version: candidate.version, owner }
}

const reconcileFileLiveDoc: OutboxHandler<unknown> = async (rawPayload, context) => {
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
        fileOwnerCondition(payload.owner),
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
    await invalidateLiveFileDoc(payload.fileId, currentVersion, context.signal, payload.owner)
    return
  }
  if (currentVersion > payload.version) return

  const content = await downloadFile({
    key: file.key,
    context: payload.owner.entityType,
    maxBytes: PASTE_LIMITS.RICH_MARKDOWN_BYTES,
    signal: context.signal,
  })
  context.signal.throwIfAborted()
  const result = await applyEditToLiveFileDoc(
    payload.fileId,
    content.toString('utf-8'),
    { version: payload.version },
    context.signal,
    payload.owner
  )
  if (result.status === 'merge-unavailable') {
    return deferOutboxHandler('Live document merge slot is temporarily unavailable')
  }
}

export const fileLiveDocOutboxHandlers = {
  [FILE_LIVE_DOC_OUTBOX_EVENT]: reconcileFileLiveDoc,
} satisfies OutboxHandlerRegistry

/** Enqueues live-document reconciliation in the same transaction as the durable file version. */
export function enqueueFileLiveDocReconciliation(
  executor: Pick<typeof db, 'insert'>,
  payload: FileLiveDocPayload
): Promise<string> {
  return enqueueOutboxEvent(executor, FILE_LIVE_DOC_OUTBOX_EVENT, payload)
}

/** Attempts a newly committed reconciliation immediately; the outbox worker owns retries. */
export function processFileLiveDocReconciliationNow(eventId: string) {
  return processOutboxEventById(eventId, fileLiveDocOutboxHandlers)
}
