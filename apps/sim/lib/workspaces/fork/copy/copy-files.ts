import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { generateWorkspaceFileKey } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'

const logger = createLogger('WorkspaceForkCopyFiles')

export interface BlobCopyTask {
  sourceKey: string
  targetKey: string
  context: StorageContext
  fileName: string
  contentType: string
  userId: string
  workspaceId: string
}

export interface PlanForkFileCopiesResult {
  /**
   * source storage key -> child storage key. `file-upload` subblocks reference
   * files by storage key (not `workspace_files.id`), so the fork remap keys on the
   * storage key. File identity is not persisted in the fork resource map - files
   * are a fork-copy-only resource (not remapped on promote).
   */
  keyMap: Map<string, string>
  /** Blob duplications to run after the fork transaction commits. */
  blobTasks: BlobCopyTask[]
}

/**
 * Insert child `workspace_files` metadata rows for the selected files (new id +
 * new storage key) and return the source→child storage-key map plus the blob
 * copies to run post-commit. The metadata row must exist before the blob upload
 * (its idempotent metadata insert reuses the row), and both must run after the
 * child workspace row exists (FK). Runs in the fork transaction; blob I/O is
 * deferred to {@link executeForkFileBlobCopies}.
 */
export async function planForkFileCopies(params: {
  tx: DbOrTx
  sourceWorkspaceId: string
  childWorkspaceId: string
  userId: string
  fileIds: string[]
  now: Date
}): Promise<PlanForkFileCopiesResult> {
  const { tx, sourceWorkspaceId, childWorkspaceId, userId, fileIds, now } = params
  const keyMap = new Map<string, string>()
  const blobTasks: BlobCopyTask[] = []
  if (fileIds.length === 0) return { keyMap, blobTasks }

  // Batch the metadata read (one query for all selected files) instead of a
  // per-file lookup. Matches getFileMetadataById's filters: non-deleted + scoped
  // to the source workspace.
  const metas = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        inArray(workspaceFiles.id, fileIds),
        eq(workspaceFiles.workspaceId, sourceWorkspaceId),
        isNull(workspaceFiles.deletedAt)
      )
    )

  for (const meta of metas) {
    const childFileId = generateId()
    // Use the canonical workspace-file key (`workspace/{id}/...`) so the file-serve
    // API can infer the storage context; a bare `{id}/...` key has no context prefix.
    const targetKey = generateWorkspaceFileKey(childWorkspaceId, meta.originalName)
    await tx.insert(workspaceFiles).values({
      ...meta,
      id: childFileId,
      key: targetKey,
      workspaceId: childWorkspaceId,
      userId,
      folderId: null,
      deletedAt: null,
      uploadedAt: now,
    })
    keyMap.set(meta.key, targetKey)
    blobTasks.push({
      sourceKey: meta.key,
      targetKey,
      context: meta.context as StorageContext,
      fileName: meta.originalName,
      contentType: meta.contentType,
      userId,
      workspaceId: childWorkspaceId,
    })
  }

  return { keyMap, blobTasks }
}

/**
 * Duplicate each planned file blob to its new key. `uploadFile`'s metadata insert
 * is idempotent on the key (the row was already created in the transaction), so
 * this only copies bytes. Best-effort: a failed blob leaves the metadata row
 * pointing at a missing object, which the user can re-upload.
 */
export async function executeForkFileBlobCopies(
  blobTasks: BlobCopyTask[],
  requestId = 'unknown'
): Promise<void> {
  for (const task of blobTasks) {
    try {
      const buffer = await downloadFile({
        key: task.sourceKey,
        context: task.context,
        maxBytes: MAX_FILE_SIZE,
      })
      await uploadFile({
        file: buffer,
        fileName: task.fileName,
        contentType: task.contentType,
        context: task.context,
        customKey: task.targetKey,
        preserveKey: true,
        metadata: {
          userId: task.userId,
          workspaceId: task.workspaceId,
          originalName: task.fileName,
        },
      })
    } catch (error) {
      logger.warn(`[${requestId}] Failed to copy file blob during fork`, {
        targetKey: task.targetKey,
        error: getErrorMessage(error),
      })
    }
  }
}
