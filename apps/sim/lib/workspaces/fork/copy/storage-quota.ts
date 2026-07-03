import { document, knowledgeBase, workspaceFiles } from '@sim/db/schema'
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { checkStorageQuota } from '@/lib/billing/storage'
import type { DbOrTx } from '@/lib/db/types'
import { ForkError } from '@/lib/workspaces/fork/lineage/authz'

/** Resource ids whose blob bytes a fork/sync copy would duplicate into the target. */
export interface ForkCopyBytesSelection {
  /** Workspace files selected by `workspace_files.id` (the fork modal's picker shape). */
  fileIds?: string[]
  /** Workspace files selected by storage key (the sync copy selection shape). */
  fileKeys?: string[]
  /** Knowledge bases whose live documents' stored blobs would be re-keyed into the target. */
  knowledgeBaseIds?: string[]
}

/**
 * Byte total of the workspace-file blobs a copy selection would duplicate. Applies the
 * same row filters as `planForkFileCopies` (source workspace, durable `workspace`
 * context, non-deleted, id/key selectors OR'd), so the sum covers exactly the rows the
 * copy would plan.
 */
async function sumWorkspaceFileBytes(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  fileIds: string[],
  fileKeys: string[]
): Promise<number> {
  if (fileIds.length === 0 && fileKeys.length === 0) return 0
  const selectors = [
    fileIds.length > 0 ? inArray(workspaceFiles.id, fileIds) : undefined,
    fileKeys.length > 0 ? inArray(workspaceFiles.key, fileKeys) : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined)
  const rows = await executor
    .select({ total: sql<string>`coalesce(sum(${workspaceFiles.size}), 0)` })
    .from(workspaceFiles)
    .where(
      and(
        selectors.length === 1 ? selectors[0] : or(...selectors),
        eq(workspaceFiles.workspaceId, sourceWorkspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
  // `sum()` comes back as a string (bigint) from the driver; coerce explicitly.
  return Number(rows[0]?.total ?? 0)
}

/**
 * Byte total of the KB document blobs the selected knowledge bases would re-key into the
 * target. Scoped to live KBs in the source workspace (mirroring the container copy) and
 * to LIVE documents with an internal blob: external/`data:` documents have a null
 * `storageKey` (no blob is duplicated), and embeddings are DB rows the upload path never
 * counts, so neither contributes bytes here.
 */
async function sumKbDocumentBytes(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  knowledgeBaseIds: string[]
): Promise<number> {
  if (knowledgeBaseIds.length === 0) return 0
  const rows = await executor
    .select({ total: sql<string>`coalesce(sum(${document.fileSize}), 0)` })
    .from(document)
    .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
    .where(
      and(
        inArray(knowledgeBase.id, knowledgeBaseIds),
        eq(knowledgeBase.workspaceId, sourceWorkspaceId),
        isNull(knowledgeBase.deletedAt),
        isNull(document.deletedAt),
        isNull(document.archivedAt),
        isNotNull(document.storageKey)
      )
    )
  return Number(rows[0]?.total ?? 0)
}

/**
 * Byte total a fork/sync copy selection would duplicate into the target: selected
 * workspace-file blobs plus the selected knowledge bases' stored document blobs. Sizes
 * come from the metadata rows (`workspace_files.size`, `document.file_size`) - no blob
 * reads. Both sums scope to the source workspace with the same filters the copy itself
 * applies, so an id that is not actually copyable can only over-count (block), never
 * under-count.
 */
export async function sumForkCopyBytes(
  executor: DbOrTx,
  sourceWorkspaceId: string,
  selection: ForkCopyBytesSelection
): Promise<number> {
  const fileBytes = await sumWorkspaceFileBytes(
    executor,
    sourceWorkspaceId,
    selection.fileIds ?? [],
    selection.fileKeys ?? []
  )
  const kbBytes = await sumKbDocumentBytes(
    executor,
    sourceWorkspaceId,
    selection.knowledgeBaseIds ?? []
  )
  return fileBytes + kbBytes
}

/**
 * Assert the initiating user's storage scope has headroom for `bytes` of copied blobs,
 * using the exact quota helper the upload path uses (`checkStorageQuota`, which resolves
 * the org-pooled vs personal scope from the user's subscription and always allows when
 * billing is disabled). Over quota throws a {@link ForkError} (413, matching the upload
 * routes' storage-limit status) carrying the upload path's quota error message, so the
 * fork/sync modals surface the same user-facing text an over-quota upload would.
 */
export async function assertForkStorageHeadroom(params: {
  userId: string
  bytes: number
}): Promise<void> {
  const { userId, bytes } = params
  if (bytes <= 0) return
  const quota = await checkStorageQuota(userId, bytes)
  if (quota.allowed) return
  throw new ForkError(
    `Not enough storage to copy the selected resources. ${quota.error ?? 'Storage limit exceeded'}`,
    413
  )
}
