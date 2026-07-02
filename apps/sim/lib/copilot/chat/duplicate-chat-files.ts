import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { incrementStorageUsage } from '@/lib/billing/storage'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const logger = createLogger('DuplicateChatFiles')

/**
 * The chat-owned storage contexts a duplicate must copy: user uploads
 * (`mothership`) and agent-generated outputs (`output`). Shared workspace
 * `files/` (`context='workspace'`) is workspace-owned, not chat-owned — both
 * chats reference it in place and it is never copied.
 */
export const DUPLICABLE_CHAT_FILE_CONTEXTS: readonly StorageContext[] = ['mothership', 'output']

export type DuplicableChatFileRow = typeof workspaceFiles.$inferSelect

/** One blob byte-copy to run after the duplicate transaction commits. */
export interface ChatBlobCopyTask {
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
 * The live chat-scoped file rows a duplicate copies: uploads + outputs owned by
 * the chat, excluding soft-deleted rows. Also used pre-transaction to sum sizes
 * for the storage-quota gate.
 */
export async function listDuplicableChatFiles(
  db: DbOrTx,
  chatId: string
): Promise<DuplicableChatFileRow[]> {
  return db
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.chatId, chatId),
        inArray(workspaceFiles.context, [...DUPLICABLE_CHAT_FILE_CONTEXTS]),
        isNull(workspaceFiles.deletedAt)
      )
    )
}

/**
 * Insert copy rows for the source chat's files under the new chat id (fresh
 * `wf_` id + fresh storage key; display names carry over verbatim because their
 * uniqueness is per-chat and the new chat is an empty namespace). Returns the
 * old->new id/key maps that drive the reference rewrite, plus the blob
 * byte-copies to run post-commit. Runs inside the duplicate transaction so a
 * failed insert rolls the whole duplicate back; blob I/O is deferred to
 * {@link executeChatFileBlobCopies}. Modeled on the workspace-fork copy
 * (`lib/workspaces/fork/copy/copy-files.ts`), adapted for chat-scoped rows.
 */
export async function planChatFileCopies(params: {
  tx: DbOrTx
  rows: DuplicableChatFileRow[]
  newChatId: string
  userId: string
  now: Date
}): Promise<PlanChatFileCopiesResult> {
  const { tx, rows, newChatId, userId, now } = params
  const idMap = new Map<string, string>()
  const keyMap = new Map<string, string>()
  const blobTasks: ChatBlobCopyTask[] = []

  for (const row of rows) {
    if (!row.workspaceId) {
      logger.warn('Skipping chat file with no workspaceId during duplicate', { fileId: row.id })
      continue
    }
    const copyId = `wf_${generateShortId()}`
    const targetKey = generateWorkspaceFileKey(row.workspaceId, row.originalName)
    await tx.insert(workspaceFiles).values({
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
      sourceKey: row.key,
      targetKey,
      context: row.context as StorageContext,
      fileName: row.originalName,
      contentType: row.contentType,
    })
  }

  return { idMap, keyMap, blobTasks }
}

/**
 * Copy each planned blob to its new key, best-effort: a failed copy logs a
 * warning and is skipped (the duplicate keeps its transcript; that one file is
 * missing) rather than failing the whole duplicate. Each successfully copied
 * file increments the storage-usage counter by its actual byte length.
 */
export async function executeChatFileBlobCopies(
  blobTasks: ChatBlobCopyTask[],
  params: { userId: string; workspaceId?: string }
): Promise<{ copied: number; failed: number }> {
  let copied = 0
  let failed = 0
  for (const task of blobTasks) {
    try {
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
        // Duplicated bytes COUNT against the storage quota, deliberately
        // diverging from the workspace-fork copy path
        // (lib/workspaces/fork/copy/copy-files.ts), which copies blobs without
        // counting them. A chat duplicate stores a second physical copy of
        // every upload/output, so the counter must reflect it. Do not "fix"
        // this back to the fork precedent.
        await incrementStorageUsage(params.userId, buffer.length, params.workspaceId)
      } catch (error) {
        logger.error('Failed to update storage tracking for duplicated chat file', {
          targetKey: task.targetKey,
          error: getErrorMessage(error),
        })
      }
    } catch (error) {
      failed += 1
      logger.warn('Failed to copy chat file blob during duplicate', {
        sourceKey: task.sourceKey,
        targetKey: task.targetKey,
        error: getErrorMessage(error),
      })
    }
  }
  return { copied, failed }
}
