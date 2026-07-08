import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { incrementStorageUsage } from '@/lib/billing/storage'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
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

export type ForkableChatFileRow = typeof workspaceFiles.$inferSelect

/** One blob byte-copy to run after the fork transaction commits. */
export interface ChatBlobCopyTask {
  /** The copied `workspace_files` row's id — used to delete the row if the blob copy fails. */
  copyId: string
  sourceKey: string
  targetKey: string
  context: StorageContext
  fileName: string
  contentType: string
}

export interface PlanChatFileCopiesResult {
  /** source `workspace_files.id` -> copy id (rewrites view-URLs, attachment ids, resource ids). */
  idMap: Map<string, string>
  /** source storage key -> copy storage key (rewrites serve-URLs, attachment keys). */
  keyMap: Map<string, string>
  /** Blob duplications to run after the transaction commits. */
  blobTasks: ChatBlobCopyTask[]
}

/**
 * Every live chat-owned file row (no timeline cut): the ghost test set for the
 * resource-chip rewrite and the superset a fork cuts down in memory via
 * {@link filterForkableChatFiles} — one `workspace_files` read serves both.
 * Also used pre-transaction to sum sizes for the storage-quota gate.
 */
export async function listForkableChatFiles(
  db: DbOrTx,
  chatId: string
): Promise<ForkableChatFileRow[]> {
  return db
    .select()
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
 * Insert copy rows for the kept chat-owned files under the new chat id (fresh
 * `wf_` id + fresh storage key; `message_id` carries over verbatim so the copy
 * matches the same message in the forked transcript; display names carry over
 * verbatim because their uniqueness is per-chat and the new chat is an empty
 * namespace). Returns the old->new id/key maps that drive the reference
 * rewrite, plus the blob byte-copies to run post-commit. Runs inside the fork
 * transaction so a failed insert rolls the whole fork back; blob I/O is
 * deferred to {@link executeChatFileBlobCopies}. Modeled on the workspace-fork
 * copy (`lib/workspaces/fork/copy/copy-files.ts`), adapted for chat-scoped rows.
 */
export async function planChatFileCopies(params: {
  tx: DbOrTx
  rows: ForkableChatFileRow[]
  newChatId: string
  userId: string
  now: Date
}): Promise<PlanChatFileCopiesResult> {
  const { tx, rows, newChatId, userId, now } = params
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

  // Ids and keys are generated client-side, so one multi-row insert suffices —
  // no per-row round trips while the fork transaction is held open.
  if (copyRows.length > 0) {
    await tx.insert(workspaceFiles).values(copyRows)
  }

  return { idMap, keyMap, blobTasks }
}

/**
 * Copy each planned blob to its new key, best-effort: a failed copy logs a
 * warning and is skipped (the fork keeps its transcript; that one file is
 * missing) rather than failing the whole fork. Runs a bounded worker pool
 * ({@link CHAT_BLOB_COPY_CONCURRENCY}) — media-heavy chats must not pay 2N
 * serial storage round-trips, but unbounded fan-out would buffer every file
 * in memory at once. Each successfully copied file increments the
 * storage-usage counter by its actual byte length. Failed tasks' copy-row ids
 * are returned so the caller can delete the dead rows (row exists, blob
 * doesn't) instead of leaving them listed in the VFS and resources with
 * nothing behind them.
 */
export async function executeChatFileBlobCopies(
  blobTasks: ChatBlobCopyTask[],
  params: { userId: string; workspaceId?: string }
): Promise<{ copied: number; failed: number; failedCopyIds: string[] }> {
  let copied = 0
  const failedCopyIds: string[] = []

  const copyOne = async (task: ChatBlobCopyTask): Promise<void> => {
    try {
      // No replay guard here, unlike the workspace-fork copy this is modeled
      // on: that path persists its task list in a trigger.dev job payload
      // (replayable), while these tasks exist only in this request's memory
      // and target keys are freshly minted per request — a HEAD check could
      // never find an earlier attempt's object.
      const buffer = await downloadFile({
        key: task.sourceKey,
        context: task.context,
        maxBytes: MAX_FILE_SIZE,
      })
      // No `metadata` here on purpose: passing it would make uploadFile insert
      // its own workspace_files row (without chatId), colliding with the row
      // the transaction already created for this key.
      await uploadFile({
        file: buffer,
        fileName: task.fileName,
        contentType: task.contentType,
        context: task.context,
        customKey: task.targetKey,
        preserveKey: true,
      })
      copied += 1
      try {
        // Forked bytes COUNT against the storage quota, deliberately diverging
        // from the workspace-fork copy path
        // (lib/workspaces/fork/copy/copy-files.ts), which copies blobs without
        // counting them. A chat fork stores a second physical copy of every
        // kept upload, so the counter must reflect it. Do not "fix" this back
        // to the workspace-fork precedent.
        await incrementStorageUsage(params.userId, buffer.length, params.workspaceId)
      } catch (error) {
        logger.error('Failed to update storage tracking for forked chat file', {
          targetKey: task.targetKey,
          error: getErrorMessage(error),
        })
      }
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
