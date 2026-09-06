import { type WorkspaceFileRow, workspaceFileColumns, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { copyWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { getWorkspaceFileSize, type StorageContext } from '@/lib/uploads/shared/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const logger = createLogger('ForkChatFiles')

/**
 * The chat-owned storage context a fork copies: user uploads (`mothership`).
 * A fork is a self-contained snapshot — bytes included (every copied row gets
 * a fresh storage key; live rows can't share a key because of the
 * `workspace_files_key_active_unique` index, and serve/view lookups resolve by
 * key) — so the new chat survives deletion of the source chat. The copied set
 * is timeline-cut to the fork point ({@link filterForkableChatFiles}).
 * Shared workspace `files/` (`context='workspace'`) is workspace-owned, not
 * chat-owned — both chats reference it in place and it is never copied.
 */
export const FORKABLE_CHAT_FILE_CONTEXT: StorageContext = 'mothership'

/** Max concurrent blob byte-copies during a chat fork. */
const CHAT_BLOB_COPY_CONCURRENCY = 4

export type ForkableChatFileRow = WorkspaceFileRow

/** One blob byte-copy to prepare before the fork is published. */
export interface ChatBlobCopyTask {
  /** The planned row's id, excluded from publication if its blob copy fails. */
  copyId: string
  sourceKey: string
  targetKey: string
  context: StorageContext
  fileName: string
  contentType: string
}

export interface PlanChatFileCopiesResult {
  rows: ForkableChatFileRow[]
  copyRows: (typeof workspaceFiles.$inferInsert)[]
  /** source `workspace_files.id` -> copy id (rewrites view-URLs, attachment ids, resource ids). */
  idMap: Map<string, string>
  /** source storage key -> copy storage key (rewrites serve-URLs, attachment keys). */
  keyMap: Map<string, string>
  /** Blob duplications that must finish before publication. */
  blobTasks: ChatBlobCopyTask[]
}

/**
 * Every live chat-owned file row (no timeline cut): the ghost test set for the
 * resource-chip rewrite and the superset a fork cuts down in memory via
 * {@link filterForkableChatFiles} — one `workspace_files` read serves both.
 */
export async function listForkableChatFiles(
  db: DbOrTx,
  chatId: string
): Promise<ForkableChatFileRow[]> {
  return db
    .select(workspaceFileColumns)
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        eq(workspaceFiles.context, FORKABLE_CHAT_FILE_CONTEXT),
        isNull(workspaceFiles.deletedAt)
      )
    )
}

/**
 * The rows a fork copies out of the chat's owned files: those whose
 * `message_id` is at-or-before the fork point (i.e. in the kept message
 * slice). Rows with a NULL `message_id` — uploads that predate messageId
 * stamping — are included in every fork of their chat: we can't know when
 * they arrived, and copying them beats forking with broken references. Pure
 * filter so the route reads `workspace_files` once per fork
 * ({@link listForkableChatFiles}).
 */
export function filterForkableChatFiles(
  rows: ForkableChatFileRow[],
  keptMessageIds: ReadonlySet<string>
): ForkableChatFileRow[] {
  return rows.filter((row) => !row.messageId || keptMessageIds.has(row.messageId))
}

/**
 * Plan copy rows for the kept chat-owned files under the new chat id (fresh
 * `wf_` id + fresh storage key; `message_id` carries over verbatim so the copy
 * matches the same message in the forked transcript; display names carry over
 * verbatim because their uniqueness is per-chat and the new chat is an empty
 * namespace). Returns the old->new id/key maps that drive the reference
 * rewrite, plus the blob byte-copies. Files and worker history are prepared before publication;
 * {@link persistChatFileCopies} inserts these rows in its final transaction.
 */
export function planChatFileCopies(params: {
  rows: ForkableChatFileRow[]
  newChatId: string
  userId: string
  now: Date
}): PlanChatFileCopiesResult {
  const { rows, newChatId, userId, now } = params
  const idMap = new Map<string, string>()
  const keyMap = new Map<string, string>()
  const blobTasks: ChatBlobCopyTask[] = []
  const copyRows: (typeof workspaceFiles.$inferInsert)[] = []

  for (const row of rows) {
    if (!row.workspaceId) {
      logger.warn('Skipping chat file with no workspaceId during fork', { fileId: row.id })
      continue
    }
    const copyId = `wf_${generateShortId()}`
    const targetKey = generateWorkspaceFileKey(row.workspaceId, row.originalName)
    copyRows.push({
      ...row,
      id: copyId,
      key: targetKey,
      chatId: newChatId,
      userId,
      sizeBytes: getWorkspaceFileSize(row),
      deletedAt: null,
      uploadedAt: now,
      updatedAt: now,
    })
    idMap.set(row.id, copyId)
    keyMap.set(row.key, targetKey)
    blobTasks.push({
      copyId,
      sourceKey: row.key,
      targetKey,
      context: row.context as StorageContext,
      fileName: row.originalName,
      contentType: row.contentType,
    })
  }

  return { rows, copyRows, idMap, keyMap, blobTasks }
}

/** Publishes only copies whose bytes were prepared, alongside the fork's transcript. */
export async function persistChatFileCopies(
  tx: DbTransaction,
  plan: PlanChatFileCopiesResult,
  failedCopyIds: ReadonlySet<string>
): Promise<void> {
  const copyRows = plan.copyRows.filter((row) => row.id && !failedCopyIds.has(row.id))
  if (copyRows.length > 0) {
    await tx.insert(workspaceFiles).values(copyRows)
    for (const source of plan.rows) {
      const targetId = plan.idMap.get(source.id)
      if (!targetId || failedCopyIds.has(targetId)) continue
      await copyWorkspaceFileSecretProvenanceInTx(
        tx,
        {
          fileId: source.id,
          key: source.key,
          contentUpdatedAtMs: source.contentUpdatedAt.getTime(),
        },
        targetId
      )
    }
  }
}

/**
 * Copy each planned blob to its new key, best-effort: a failed copy logs a
 * warning and is skipped (the fork keeps its transcript; that one file is
 * missing) rather than failing the whole fork. Runs a bounded worker pool
 * ({@link CHAT_BLOB_COPY_CONCURRENCY}) — media-heavy chats must not pay 2N
 * serial storage round-trips, but unbounded fan-out would buffer every file
 * in memory at once. Mothership files remain excluded from workspace storage
 * accounting. Failed tasks' copy-row ids are excluded from the final transaction
 * so neither metadata nor resource chips claim missing bytes are available.
 */
export async function executeChatFileBlobCopies(
  blobTasks: ChatBlobCopyTask[]
): Promise<{ copied: number; failed: number; failedCopyIds: string[] }> {
  let copied = 0
  const failedCopyIds: string[] = []

  const copyOne = async (task: ChatBlobCopyTask): Promise<void> => {
    try {
      const buffer = await downloadFile({
        key: task.sourceKey,
        context: task.context,
        maxBytes: MAX_FILE_SIZE,
      })
      /** Metadata is published with the chat only after preparation succeeds. */
      await uploadFile({
        file: buffer,
        fileName: task.fileName,
        contentType: task.contentType,
        context: task.context,
        customKey: task.targetKey,
        preserveKey: true,
      })
      copied += 1
    } catch (error) {
      failedCopyIds.push(task.copyId)
      logger.warn('Failed to copy chat file blob during fork', {
        sourceKey: task.sourceKey,
        targetKey: task.targetKey,
        error: getErrorMessage(error),
      })
    }
  }

  await mapWithConcurrency(blobTasks, CHAT_BLOB_COPY_CONCURRENCY, copyOne)

  return { copied, failed: failedCopyIds.length, failedCopyIds }
}
