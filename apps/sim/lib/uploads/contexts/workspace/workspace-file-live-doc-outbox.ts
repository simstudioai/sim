import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
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
import { WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT } from '@/lib/uploads/contexts/workspace/file-outbox-events'
import { downloadFile } from '@/lib/uploads/core/storage-service'
import { isMarkdownFile } from '@/lib/uploads/utils/file-utils'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

type WorkspaceFileLiveDocPayload = { fileId: string; version: number } & (
  | { workspaceId: string; owner?: never }
  | { owner: { entityType: 'project'; entityId: string }; workspaceId?: never }
)

interface ParsedLiveDocPayload {
  fileId: string
  version: number
  owner: EditableFileOwner
}

interface LiveDocDelivery {
  invalidate(target: ParsedLiveDocPayload, version: number, signal: AbortSignal): Promise<void>
  merge(
    target: ParsedLiveDocPayload,
    markdown: string,
    signal: AbortSignal
  ): ReturnType<typeof applyEditToLiveFileDoc>
}

const LIVE_DOC_DELIVERY: FileOwnerAdapters<LiveDocDelivery> = {
  workspace: {
    invalidate: (target, version, signal) => invalidateLiveFileDoc(target.fileId, version, signal),
    merge: (target, markdown, signal) =>
      applyEditToLiveFileDoc(target.fileId, markdown, { version: target.version }, signal),
  },
  project: {
    invalidate: (target, version, signal) =>
      invalidateLiveFileDoc(target.fileId, version, signal, {
        entityType: 'project',
        entityId: target.owner.entityId,
      }),
    merge: (target, markdown, signal) =>
      applyEditToLiveFileDoc(target.fileId, markdown, { version: target.version }, signal, {
        entityType: 'project',
        entityId: target.owner.entityId,
      }),
  },
}

function parsePayload(payload: unknown): ParsedLiveDocPayload {
  if (!isRecordLike(payload)) {
    throw new Error('Workspace file live-document outbox payload must be an object')
  }
  const candidate = payload as Partial<WorkspaceFileLiveDocPayload>
  let owner: EditableFileOwner
  if (candidate.owner !== undefined) {
    if (
      candidate.workspaceId !== undefined ||
      !isRecordLike(candidate.owner) ||
      candidate.owner.entityType !== 'project' ||
      typeof candidate.owner.entityId !== 'string' ||
      !candidate.owner.entityId
    )
      throw new Error('Invalid Project live-document owner')
    owner = { entityType: 'project', entityId: candidate.owner.entityId }
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
        fileOwnerCondition(payload.owner),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (!file) return
  const delivery = requireFileOwnerAdapter(LIVE_DOC_DELIVERY, payload.owner)
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
    await delivery.invalidate(payload, currentVersion, context.signal)
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
  const result = await delivery.merge(payload, content.toString('utf-8'), context.signal)
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
