import { db } from '@sim/db'
import { workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import {
  incrementStorageUsageForBillingContextInTx,
  resolveStorageBillingContext,
} from '@/lib/billing/storage'
import type { DbOrTx } from '@/lib/db/types'
import {
  allocateUniqueWorkspaceFileName,
  generateWorkspaceFileKey,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { copyWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  deleteFile,
  downloadFile,
  headObject,
  uploadFile,
} from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { resolveForkFolderMapping } from '@/ee/workspace-forking/lib/copy/copy-workflows'
import {
  type ForkContentRefMaps,
  rewriteForkContentRefs,
} from '@/ee/workspace-forking/lib/remap/remap-content-refs'

const logger = createLogger('WorkspaceForkCopyFiles')

const BLOB_COPY_PAGE = 500
const MARKDOWN_CONTENT_TYPES = new Set(['text/markdown', 'text/x-markdown'])

function isMarkdownBlob(task: Pick<BlobCopyTask, 'contentType' | 'fileName'>): boolean {
  if (MARKDOWN_CONTENT_TYPES.has(task.contentType)) return true
  const name = task.fileName.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.mdx') || name.endsWith('.markdown')
}

export interface BlobCopyTask {
  /** Added after persisted fork jobs shipped; absence marks only copied-file provenance unknown. */
  sourceFileId?: string
  /** Added after persisted fork jobs shipped; absence marks only copied-file provenance unknown. */
  sourceContentUpdatedAtMs?: number
  sourceKey: string
  targetKey: string
  context: StorageContext
  fileName: string
  contentType: string
  /**
   * Byte size from the source metadata row. Finalization writes this same size
   * to the child row and increments the ledgers by it in the same transaction.
   */
  size: number
  /** Stable metadata id generated while the source-to-target maps are planned. */
  targetFileId: string
  displayName: string | null
  userId: string
  workspaceId: string
  /**
   * Target file-folder id, already created inside the copy transaction by
   * {@link resolveForkFolderMapping}. Optional because tasks queued by an earlier deploy have
   * no such field: those replay as `undefined` and finalize at the target root, exactly as
   * they did before folder structure transited a fork edge.
   */
  targetFolderId?: string | null
}

export interface PlanForkFileCopiesResult {
  /**
   * source storage key -> child storage key. `file-upload` subblocks reference
   * files by storage key (not `workspace_files.id`), so the fork remap keys on the
   * storage key. At sync time this map is persisted in the fork resource map
   * (`resourceType: 'file'`, keyed by storage key) so a re-sync resolves the copy
   * instead of re-copying; at create-fork time it is not (the child is brand new).
   */
  keyMap: Map<string, string>
  /**
   * source `workspace_files.id` -> child id. Used to rewrite in-content file references
   * that key on the file id (`sim:file/<id>`, `/api/files/view/<id>`, the in-app files
   * path) inside copied skill/markdown content; not persisted in the fork resource map.
   */
  idMap: Map<string, string>
  /** Blob duplications plus deferred metadata to finalize after the fork transaction commits. */
  blobTasks: BlobCopyTask[]
  /**
   * source file-folder id -> target file-folder id for the mirrored subtree. Merged into the
   * content-ref maps so `sim:folder/<id>` mentions inside copied bodies resolve to the copy.
   */
  folderIdMap: Map<string, string>
}

async function getFinalizedFileCopies(
  tasks: BlobCopyTask[]
): Promise<Map<string, { key: string; workspaceId: string | null }>> {
  if (tasks.length === 0) return new Map()
  const active = await db
    .select({
      id: workspaceFiles.id,
      key: workspaceFiles.key,
      workspaceId: workspaceFiles.workspaceId,
    })
    .from(workspaceFiles)
    .where(
      and(
        inArray(
          workspaceFiles.id,
          tasks.map((task) => task.targetFileId)
        ),
        isNull(workspaceFiles.deletedAt)
      )
    )
  return new Map(active.map((row) => [row.id, { key: row.key, workspaceId: row.workspaceId }]))
}

/**
 * Pick the child row's `original_name`, de-duplicating against the partial unique index
 * `workspace_files_workspace_folder_name_active_unique` on
 * `(workspace_id, coalesce(folder_id, ''), original_name)`.
 *
 * Since the fork copy started preserving folder structure, a target folder reused by
 * {@link resolveForkFolderMapping} can already hold a file of the same name (parent has
 * `Reports/budget.xlsx`, the child pushes its own `Reports/budget.xlsx`). Reusing the source
 * name would violate that index, so the copy lands as `budget (1).xlsx` instead: both files
 * survive, the copy stays visible in the fork under the mirrored folder, and its blob is kept.
 *
 * Advisory only. The lookup runs outside the finalize transaction (and so cannot see it), so a
 * concurrent upload can still claim the name in between. The index stays the authority: such a
 * task fails loudly into `failedTargetKeys` instead of being silently dropped.
 */
async function resolveTargetOriginalName(task: BlobCopyTask): Promise<string> {
  // The index is partial on durable workspace files; no other context can collide on it.
  if (task.context !== 'workspace') return task.fileName
  return allocateUniqueWorkspaceFileName(
    task.workspaceId,
    task.fileName,
    task.targetFolderId ?? null
  )
}

/**
 * Plan child metadata identities and blob copies without inserting an active
 * `workspace_files` row. The child workspace and source mappings are committed
 * first; each metadata row is created only after its blob lands, atomically with
 * the target workspace payer increment in {@link executeForkFileBlobCopies}.
 *
 * Files are selected EITHER by `workspace_files.id` (the fork modal's picker lists files
 * by id) OR by storage `key` (sync references key files by their storage key, not id). At
 * least one of the two must be non-empty; both may be supplied (their matched rows union).
 */
export async function planForkFileCopies(params: {
  tx: DbOrTx
  sourceWorkspaceId: string
  childWorkspaceId: string
  userId: string
  fileIds?: string[]
  fileKeys?: string[]
  now: Date
}): Promise<PlanForkFileCopiesResult> {
  const { tx, sourceWorkspaceId, childWorkspaceId, userId } = params
  const fileIds = params.fileIds ?? []
  const fileKeys = params.fileKeys ?? []
  const keyMap = new Map<string, string>()
  const idMap = new Map<string, string>()
  const blobTasks: BlobCopyTask[] = []
  let folderIdMap = new Map<string, string>()
  if (fileIds.length === 0 && fileKeys.length === 0)
    return { keyMap, idMap, blobTasks, folderIdMap }

  // Match by id and/or storage key (OR'd) so either selection shape resolves to the same
  // source rows. Batch the metadata read (one query for all selected files): non-deleted,
  // scoped to the source workspace, and restricted to durable `workspace` files. Only
  // workspace files are forkable - chat/copilot/mothership uploads are session-scoped and
  // their chat-bound unique index can't be duplicated - so any non-workspace id/key passed
  // here is ignored rather than copied.
  const selectors = [
    fileIds.length > 0 ? inArray(workspaceFiles.id, fileIds) : undefined,
    fileKeys.length > 0 ? inArray(workspaceFiles.key, fileKeys) : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined)
  const metas = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        selectors.length === 1 ? selectors[0] : or(...selectors),
        eq(workspaceFiles.workspaceId, sourceWorkspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )

  // Mirror the file-folder subtree holding the selected files (plus ancestors) into the target
  // and place each copy inside it. Scoped to `resourceType: 'file'`: file folders are a tree of
  // their own, disjoint from the workflow folders the workflow copy mirrors.
  folderIdMap = await resolveForkFolderMapping({
    tx,
    sourceWorkspaceId,
    targetWorkspaceId: childWorkspaceId,
    userId,
    now: params.now,
    resourceType: 'file',
    contentFolderIds: metas.map((meta) => meta.folderId),
  })

  for (const meta of metas) {
    const childFileId = generateId()
    // Use the canonical workspace-file key (`workspace/{id}/...`) so the file-serve
    // API can infer the storage context; a bare `{id}/...` key has no context prefix.
    const targetKey = generateWorkspaceFileKey(childWorkspaceId, meta.originalName)
    keyMap.set(meta.key, targetKey)
    idMap.set(meta.id, childFileId)
    blobTasks.push({
      sourceFileId: meta.id,
      sourceContentUpdatedAtMs: meta.contentUpdatedAt.getTime(),
      sourceKey: meta.key,
      targetKey,
      context: meta.context as StorageContext,
      fileName: meta.originalName,
      contentType: meta.contentType,
      size: meta.size,
      targetFileId: childFileId,
      displayName: meta.displayName,
      userId,
      workspaceId: childWorkspaceId,
      // An unmapped folder (pruned, or archived mid-copy) re-roots the file, matching how a
      // copied workflow falls back to the target root.
      targetFolderId: meta.folderId ? (folderIdMap.get(meta.folderId) ?? null) : null,
    })
  }

  return { keyMap, idMap, blobTasks, folderIdMap }
}

/**
 * Duplicate each planned file blob to its new key, then finalize its metadata and
 * exact target-workspace accounting in one short transaction. Markdown blobs
 * additionally have their in-content references
 * (`sim:` links, embedded file/image URLs) rewritten through `contentRefMaps` so they
 * point at the copied resources (unmapped targets are left as graceful broken links).
 * Best-effort: a content-rewrite failure falls back to copying the raw bytes. A failed
 * blob's child storage key is returned in `failedTargetKeys` so the caller can clear the
 * `file-upload` references pointing at the now-missing object. A failed task has no
 * active target metadata; an object uploaded before a failed finalization is deleted
 * best-effort outside the transaction.
 *
 * A copy whose name is already taken inside its mirrored target folder is de-duplicated
 * (`budget (1).xlsx`) rather than dropped - see {@link resolveTargetOriginalName}. Those
 * still count as `copied`.
 */
export async function executeForkFileBlobCopies(
  blobTasks: BlobCopyTask[],
  requestId = 'unknown',
  contentRefMaps?: ForkContentRefMaps
): Promise<{ copied: number; failed: number; failedTargetKeys: string[] }> {
  let copied = 0
  const failedTargetKeys: string[] = []
  for (let offset = 0; offset < blobTasks.length; offset += BLOB_COPY_PAGE) {
    const taskPage = blobTasks.slice(offset, offset + BLOB_COPY_PAGE)
    let finalizedById: Map<string, { key: string; workspaceId: string | null }>
    try {
      finalizedById = await getFinalizedFileCopies(taskPage)
    } catch (error) {
      for (const task of taskPage) {
        failedTargetKeys.push(task.targetKey)
        logger.warn(`[${requestId}] Failed to check copied file replay state`, {
          targetKey: task.targetKey,
          error: getErrorMessage(error),
        })
      }
      continue
    }

    for (const task of taskPage) {
      let uploadedThisAttempt = false
      try {
        const finalized = finalizedById.get(task.targetFileId)
        if (finalized) {
          if (finalized.key !== task.targetKey || finalized.workspaceId !== task.workspaceId) {
            throw new Error(`Conflicting target metadata for copied file ${task.targetFileId}`)
          }
          copied += 1
          continue
        }
        const existing = await headObject(task.targetKey, task.context)
        if (!existing) {
          const buffer = await downloadFile({
            key: task.sourceKey,
            context: task.context,
            maxBytes: MAX_FILE_SIZE,
          })
          let body: Buffer = buffer
          if (contentRefMaps && isMarkdownBlob(task)) {
            try {
              const text = buffer.toString('utf8')
              const rewritten = rewriteForkContentRefs(text, contentRefMaps)
              if (rewritten !== text) body = Buffer.from(rewritten, 'utf8')
            } catch (error) {
              logger.warn(
                `[${requestId}] Failed to rewrite markdown blob content; copying raw bytes`,
                {
                  targetKey: task.targetKey,
                  error: getErrorMessage(error),
                }
              )
            }
          }
          await uploadFile({
            file: body,
            fileName: task.fileName,
            contentType: task.contentType,
            context: task.context,
            customKey: task.targetKey,
            preserveKey: true,
            persistMetadata: false,
            metadata: {
              userId: task.userId,
              workspaceId: task.workspaceId,
              originalName: task.fileName,
            },
          })
          uploadedThisAttempt = true
        }

        const billingContext = await resolveStorageBillingContext(task.workspaceId)
        const targetOriginalName = await resolveTargetOriginalName(task)
        const targetDisplayName =
          targetOriginalName === task.fileName ? task.displayName : targetOriginalName
        await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(workspaceFiles)
            .values({
              id: task.targetFileId,
              key: task.targetKey,
              userId: task.userId,
              workspaceId: task.workspaceId,
              folderId: task.targetFolderId ?? null,
              context: task.context,
              chatId: null,
              originalName: targetOriginalName,
              displayName: targetDisplayName,
              contentType: task.contentType,
              size: task.size,
              deletedAt: null,
              uploadedAt: new Date(),
            })
            // Targeted at the primary key so ONLY a replay of this same task is absorbed. A
            // bare `onConflictDoNothing()` also swallows the `(workspace_id, folder_id,
            // original_name)` unique index, whose conflicting row has a DIFFERENT id - the
            // recovery below then finds nothing and drops a file that merely shares a name.
            .onConflictDoNothing({ target: workspaceFiles.id })
            .returning({ id: workspaceFiles.id })

          // Reachable only on a primary-key conflict, so the row is addressable by id.
          if (!inserted) {
            const [current] = await tx
              .select({
                id: workspaceFiles.id,
                key: workspaceFiles.key,
                workspaceId: workspaceFiles.workspaceId,
                deletedAt: workspaceFiles.deletedAt,
              })
              .from(workspaceFiles)
              .where(eq(workspaceFiles.id, task.targetFileId))
              .for('update')
              .limit(1)
            if (
              current?.deletedAt === null &&
              current.key === task.targetKey &&
              current.workspaceId === task.workspaceId
            ) {
              return
            }
            if (
              !current ||
              current.key !== task.targetKey ||
              current.workspaceId !== task.workspaceId
            ) {
              throw new Error(`Conflicting target metadata for copied file ${task.targetFileId}`)
            }
            await tx
              .update(workspaceFiles)
              .set({
                userId: task.userId,
                folderId: task.targetFolderId ?? null,
                context: task.context,
                chatId: null,
                originalName: targetOriginalName,
                displayName: targetDisplayName,
                contentType: task.contentType,
                size: task.size,
                deletedAt: null,
                uploadedAt: new Date(),
              })
              .where(eq(workspaceFiles.id, task.targetFileId))
          }
          await copyWorkspaceFileSecretProvenanceInTx(
            tx,
            typeof task.sourceFileId === 'string' &&
              typeof task.sourceContentUpdatedAtMs === 'number' &&
              Number.isFinite(task.sourceContentUpdatedAtMs)
              ? {
                  fileId: task.sourceFileId,
                  key: task.sourceKey,
                  contentUpdatedAtMs: task.sourceContentUpdatedAtMs,
                }
              : undefined,
            task.targetFileId
          )
          await incrementStorageUsageForBillingContextInTx(tx, billingContext, task.size)
        })
        copied += 1
        if (targetOriginalName !== task.fileName) {
          logger.warn(`[${requestId}] Copied file renamed to avoid a target name collision`, {
            targetKey: task.targetKey,
            folderId: task.targetFolderId ?? null,
            from: task.fileName,
            to: targetOriginalName,
          })
        }
      } catch (error) {
        failedTargetKeys.push(task.targetKey)
        logger.warn(`[${requestId}] Failed to copy file blob during fork`, {
          targetKey: task.targetKey,
          error: getErrorMessage(error),
        })
        if (uploadedThisAttempt) {
          try {
            const [active] = await db
              .select({ id: workspaceFiles.id })
              .from(workspaceFiles)
              .where(
                and(
                  eq(workspaceFiles.id, task.targetFileId),
                  eq(workspaceFiles.key, task.targetKey),
                  isNull(workspaceFiles.deletedAt)
                )
              )
              .limit(1)
            if (!active) {
              await deleteFile({ key: task.targetKey, context: task.context })
            }
          } catch (cleanupError) {
            logger.warn(`[${requestId}] Failed to clean up unfinalized copied file blob`, {
              targetKey: task.targetKey,
              error: getErrorMessage(cleanupError),
            })
          }
        }
      }
    }
  }
  return { copied, failed: failedTargetKeys.length, failedTargetKeys }
}
