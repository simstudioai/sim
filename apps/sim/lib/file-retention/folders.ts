import { dbFor } from '@sim/db'
import { folder, workspaceFiles } from '@sim/db/schema'
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import {
  consumeRowBudget,
  DEFAULT_MAX_BATCHES_PER_TABLE,
  type RowBudget,
} from '@/lib/cleanup/batch-delete'
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import type { DbTransaction } from '@/lib/db/types'
import { FILES_PER_QUERY } from '@/lib/file-retention/versions'
import { deduplicateFolderNameInScope } from '@/lib/folders/naming'
import { lockWorkspaceProject } from '@/lib/projects/membership'
import { workspaceFileNameFolderCondition } from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { lockFileDirectories } from '@/lib/workspace-files/locks'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileFolderOwnerCondition, fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

const cleanupDb = dbFor('cleanup')

/** Recheck expiry and keep child re-rooting atomic with the parent deletion. */
export async function cleanupExpiredFileFolderInTx(
  tx: DbTransaction,
  owner: EditableFileOwner,
  cutoff: Date,
  budget?: RowBudget
): Promise<number> {
  const folderScope = fileFolderOwnerCondition(owner)
  await lockFileDirectories(tx, [owner])
  const [expired] = await tx
    .select({ id: folder.id })
    .from(folder)
    .where(and(folderScope, isNotNull(folder.deletedAt), lt(folder.deletedAt, cutoff)))
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
          fileOwnerCondition(owner),
          eq(workspaceFiles.folderId, expired.id),
          isNull(workspaceFiles.deletedAt)
        )
      )
      .orderBy(asc(workspaceFiles.id))
      .limit(FILES_PER_QUERY)
      .for('update')
    if (!children.length) break
    const candidateNames = new Set(children.map(({ name }) => name))
    const rootFiles = await tx
      .select({ name: workspaceFiles.originalName })
      .from(workspaceFiles)
      .where(
        and(
          fileOwnerCondition(owner),
          workspaceFileNameFolderCondition(null),
          isNull(workspaceFiles.deletedAt),
          inArray(workspaceFiles.originalName, [...candidateNames])
        )
      )
    const rootNames = new Set(rootFiles.map(({ name }) => name))
    const renamed: { id: string; name: string }[] = []
    for (const child of children) {
      const name = await generateRestoreName(
        child.name,
        async (candidate) => {
          if (rootNames.has(candidate)) return true
          if (candidateNames.has(candidate)) return false
          const [existing] = await tx
            .select({ id: workspaceFiles.id })
            .from(workspaceFiles)
            .where(
              and(
                fileOwnerCondition(owner),
                workspaceFileNameFolderCondition(null),
                isNull(workspaceFiles.deletedAt),
                eq(workspaceFiles.originalName, candidate)
              )
            )
            .limit(1)
          return Boolean(existing)
        },
        { hasExtension: true }
      )
      rootNames.add(name)
      renamed.push({ id: child.id, name })
    }
    await tx
      .update(workspaceFiles)
      .set({
        folderId: null,
        originalName: sql`CASE ${workspaceFiles.id} ${sql.join(
          renamed.map(({ id, name }) => sql`WHEN ${id} THEN ${name}`),
          sql` `
        )} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          fileOwnerCondition(owner),
          inArray(
            workspaceFiles.id,
            renamed.map(({ id }) => id)
          )
        )
      )
  }
  await tx.delete(folder).where(and(folderScope, eq(folder.id, expired.id)))
  return 1
}

/** Workspace file folders share the directory transaction used by Project folders. */
export async function cleanupArchivedWorkspaceFileFolders(
  workspaceIds: string[],
  cutoff: Date,
  budget?: RowBudget
): Promise<number> {
  let total = 0
  for (const workspaceId of workspaceIds) {
    for (let batch = 0; batch < DEFAULT_MAX_BATCHES_PER_TABLE && budget?.remaining !== 0; batch++) {
      const removed = await cleanupDb.transaction(async (tx) => {
        await lockWorkspaceProject(tx, workspaceId)
        return cleanupExpiredFileFolderInTx(
          tx,
          { entityType: 'workspace', entityId: workspaceId },
          cutoff,
          budget
        )
      })
      total += removed
      if (!removed) break
    }
  }
  return total
}
