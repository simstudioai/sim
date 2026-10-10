import { dbFor } from '@sim/db'
import { folder, organization, project, workspaceFiles, workspaceFileVersion } from '@sim/db/schema'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, min, or, sql } from 'drizzle-orm'
import { CLEANUP_CONFIG } from '@/lib/billing/cleanup-dispatcher'
import { getPlanType } from '@/lib/billing/plan-helpers'
import { resolveProjectStorageBillingContext } from '@/lib/billing/storage/context'
import { prepareProjectStorageMutationInTx } from '@/lib/billing/storage/tracking'
import {
  consumeRowBudget,
  DEFAULT_DELETE_CHUNK_SIZE,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  type RowBudget,
} from '@/lib/cleanup/batch-delete'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { deduplicateFolderNameInScope } from '@/lib/folders/naming'
import { lockProject } from '@/lib/projects/membership'
import { workspaceFileNameFolderCondition } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'
import {
  MAX_SUPERSEDED_FILE_VERSIONS,
  releaseWorkspaceFileVersionsForPurgeInTx,
} from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { fileFolderOwnerCondition, fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

const cleanupDb = dbFor('cleanup')
const KEEP_SUPERSEDED = 9
const FILES_PER_QUERY = 500

type FileRetentionJob = 'cleanup-file-versions' | 'cleanup-soft-deletes'

/** Fresh owner and payer policy wins over a queued plan or an environment's retention settings. */
async function prepareRetention(tx: DbTransaction, projectId: string, job: FileRetentionJob) {
  await lockProject(tx, projectId)
  const [owner] = await tx.select().from(project).where(eq(project.id, projectId)).limit(1)
  if (!owner || owner.archivedAt) return null
  const billing = await resolveProjectStorageBillingContext(
    { projectId, ownerId: owner.ownerId, organizationId: owner.organizationId },
    tx
  )
  if (isBillingEnabled && owner.organizationId && billing.plan === null) return null
  const mutation = await prepareProjectStorageMutationInTx(tx, billing)
  const plan = isBillingEnabled ? getPlanType(billing.plan) : 'enterprise'
  const config = CLEANUP_CONFIG[job]
  let hours: number | null = config.defaults[plan]
  if (plan === 'enterprise' && owner.organizationId) {
    const [payer] = await tx
      .select({ settings: organization.dataRetentionSettings })
      .from(organization)
      .where(eq(organization.id, owner.organizationId))
      .limit(1)
    hours = payer?.settings?.[config.key] ?? null
  }
  if (hours === null) return null
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Invalid Project retention policy')
  return { cutoff: new Date(Date.now() - hours * 60 * 60 * 1000), plan, mutation }
}

function projectFiles(projectId: string) {
  return fileOwnerCondition({ entityType: 'project', entityId: projectId })
}

/** Releases only superseded history, retaining the current head and the newest nine predecessors. */
export async function cleanupProjectFileVersions(
  projectId: string,
  limit: number
): Promise<number> {
  let released = 0
  let afterId = ''
  while (released < limit) {
    const batch = await cleanupDb.transaction(async (tx) => {
      const policy = await prepareRetention(tx, projectId, 'cleanup-file-versions')
      if (!policy) return null
      const maximum = policy.plan === 'free' ? 99 : MAX_SUPERSEDED_FILE_VERSIONS
      const candidates = await tx
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .innerJoin(workspaceFileVersion, eq(workspaceFileVersion.fileId, workspaceFiles.id))
        .where(
          and(
            projectFiles(projectId),
            gt(workspaceFiles.id, afterId),
            isNotNull(workspaceFileVersion.supersededAt)
          )
        )
        .groupBy(workspaceFiles.id)
        .having(
          and(
            gt(count(), KEEP_SUPERSEDED),
            or(
              lt(
                min(workspaceFileVersion.supersededAt),
                sql.param(policy.cutoff, workspaceFileVersion.supersededAt)
              ),
              gt(count(), maximum)
            )
          )
        )
        .orderBy(asc(workspaceFiles.id))
        .limit(FILES_PER_QUERY)
      if (!candidates.length) return null
      await tx
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          inArray(
            workspaceFiles.id,
            candidates.map((row) => row.id)
          )
        )
        .orderBy(asc(workspaceFiles.id))
        .for('update')
      const ranked = tx
        .select({
          id: workspaceFileVersion.id,
          supersededAt: workspaceFileVersion.supersededAt,
          rank: sql<number>`row_number() over (partition by ${workspaceFileVersion.fileId} order by ${workspaceFileVersion.version} desc)`.as(
            'rank'
          ),
        })
        .from(workspaceFileVersion)
        .where(
          and(
            inArray(
              workspaceFileVersion.fileId,
              candidates.map((row) => row.id)
            ),
            isNotNull(workspaceFileVersion.supersededAt)
          )
        )
        .as('ranked')
      const versionLimit = Math.min(DEFAULT_DELETE_CHUNK_SIZE, limit - released)
      const expired = await tx
        .select({ id: ranked.id })
        .from(ranked)
        .where(
          and(
            gt(ranked.rank, KEEP_SUPERSEDED),
            or(lt(ranked.supersededAt, policy.cutoff), gt(ranked.rank, maximum))
          )
        )
        .limit(versionLimit)
      const removed = expired.length
        ? await tx
            .delete(workspaceFileVersion)
            .where(
              and(
                inArray(
                  workspaceFileVersion.id,
                  expired.map((row) => row.id)
                ),
                isNotNull(workspaceFileVersion.supersededAt)
              )
            )
            .returning({ key: workspaceFileVersion.key })
        : []
      await enqueueWorkspaceFileStorageCleanups(
        tx,
        removed.map((row) => row.key),
        'project'
      )
      return {
        lastId: removed.length === versionLimit ? afterId : candidates[candidates.length - 1].id,
        removed: removed.length,
      }
    })
    if (!batch) break
    afterId = batch.lastId
    released += batch.removed
  }
  return released
}

/** Head rows, history, billed bytes, and cleanup intents commit or roll back together. */
export async function cleanupArchivedProjectFiles(
  projectId: string,
  budget?: RowBudget
): Promise<number> {
  let total = 0
  for (let batch = 0; batch < DEFAULT_MAX_BATCHES_PER_TABLE && budget?.remaining !== 0; batch++) {
    const removed = await cleanupDb.transaction(async (tx) => {
      const policy = await prepareRetention(tx, projectId, 'cleanup-soft-deletes')
      if (!policy) return 0
      await acquireFolderMutationLock(tx, `project:${projectId}`, 'file')
      const rows = await tx
        .select({
          id: workspaceFiles.id,
          key: workspaceFiles.key,
          sizeBytes: workspaceFiles.sizeBytes,
        })
        .from(workspaceFiles)
        .where(
          and(
            projectFiles(projectId),
            isNotNull(workspaceFiles.deletedAt),
            lt(workspaceFiles.deletedAt, policy.cutoff)
          )
        )
        .orderBy(asc(workspaceFiles.id))
        .limit(Math.min(DEFAULT_DELETE_CHUNK_SIZE, budget?.remaining ?? DEFAULT_DELETE_CHUNK_SIZE))
        .for('update')
      if (!rows.length) return 0
      consumeRowBudget(budget, rows.length)
      let bytes = 0
      for (const row of rows) {
        if (
          row.sizeBytes === null ||
          !Number.isSafeInteger(row.sizeBytes) ||
          row.sizeBytes < 0 ||
          !row.key.startsWith(`project/${projectId}/`)
        )
          throw new Error('Project retention requires canonical file bytes and keys')
        bytes += row.sizeBytes
        if (!Number.isSafeInteger(bytes))
          throw new Error('Project retention storage exceeds the safe range')
      }
      const ids = rows.map((row) => row.id)
      await releaseWorkspaceFileVersionsForPurgeInTx(tx, ids, policy.cutoff)
      await enqueueWorkspaceFileStorageCleanups(
        tx,
        rows.map((row) => row.key),
        'project'
      )
      await tx
        .delete(workspaceFiles)
        .where(and(projectFiles(projectId), inArray(workspaceFiles.id, ids)))
      await policy.mutation.applyDelta(-bytes)
      return rows.length
    })
    total += removed
    if (!removed) break
  }
  return total
}

/** Surviving children are re-rooted under the directory lock before an expired folder is removed. */
export async function cleanupArchivedProjectFileFolders(
  projectId: string,
  budget?: RowBudget
): Promise<number> {
  let total = 0
  const owner = { entityType: 'project' as const, entityId: projectId }
  const folderScope = fileFolderOwnerCondition(owner)
  for (let batch = 0; batch < DEFAULT_MAX_BATCHES_PER_TABLE && budget?.remaining !== 0; batch++) {
    const removed = await cleanupDb.transaction(async (tx) => {
      const policy = await prepareRetention(tx, projectId, 'cleanup-soft-deletes')
      if (!policy) return 0
      await acquireFolderMutationLock(tx, `project:${projectId}`, 'file')
      const [expired] = await tx
        .select({ id: folder.id })
        .from(folder)
        .where(and(folderScope, isNotNull(folder.deletedAt), lt(folder.deletedAt, policy.cutoff)))
        .orderBy(asc(folder.id))
        .limit(1)
        .for('update')
      if (!expired) return 0
      consumeRowBudget(budget, 1)
      for (;;) {
        const children = await tx
          .select({ id: folder.id, name: folder.name })
          .from(folder)
          .where(and(folderScope, eq(folder.parentId, expired.id), isNull(folder.deletedAt)))
          .orderBy(asc(folder.id))
          .limit(FILES_PER_QUERY)
          .for('update')
        if (!children.length) break
        for (const child of children) {
          const name = await deduplicateFolderNameInScope(tx, folderScope, null, child.name)
          await tx
            .update(folder)
            .set({ parentId: null, name, updatedAt: new Date() })
            .where(and(folderScope, eq(folder.id, child.id)))
        }
      }
      for (;;) {
        const children = await tx
          .select({ id: workspaceFiles.id, name: workspaceFiles.originalName })
          .from(workspaceFiles)
          .where(
            and(
              projectFiles(projectId),
              eq(workspaceFiles.folderId, expired.id),
              isNull(workspaceFiles.deletedAt)
            )
          )
          .orderBy(asc(workspaceFiles.id))
          .limit(FILES_PER_QUERY)
          .for('update')
        if (!children.length) break
        for (const child of children) {
          const originalName = await generateRestoreName(
            child.name,
            async (name) => {
              const [existing] = await tx
                .select({ id: workspaceFiles.id })
                .from(workspaceFiles)
                .where(
                  and(
                    projectFiles(projectId),
                    eq(workspaceFiles.originalName, name),
                    workspaceFileNameFolderCondition(null),
                    isNull(workspaceFiles.deletedAt)
                  )
                )
                .limit(1)
              return Boolean(existing)
            },
            { hasExtension: true }
          )
          await tx
            .update(workspaceFiles)
            .set({ folderId: null, originalName, updatedAt: new Date() })
            .where(and(projectFiles(projectId), eq(workspaceFiles.id, child.id)))
        }
      }
      await tx.delete(folder).where(and(folderScope, eq(folder.id, expired.id)))
      return 1
    })
    total += removed
    if (!removed) break
  }
  return total
}
