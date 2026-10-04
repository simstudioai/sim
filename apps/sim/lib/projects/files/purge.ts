import { folder, publicShare, workspaceFiles, workspaceFileVersion } from '@sim/db/schema'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import { retireProjectUploadsInTx } from '@/lib/projects/files/prefix-cleanup'
import { enqueueWorkspaceFileStorageCleanups } from '@/lib/uploads/contexts/workspace/workspace-file-storage-cleanup-outbox'

const PURGE_BATCH_SIZE = 500

/**
 * Retires a Project's file tree after its lifecycle transaction locks the Project and payer
 * and debits the exact retained heads. Blob deletion is durable work, never a precommit effect.
 */
export async function purgeProjectFilesInTx(
  tx: DbTransaction,
  projectId: string,
  expectedBillableBytes: number
): Promise<string[]> {
  await retireProjectUploadsInTx(tx, projectId)
  await acquireFolderMutationLock(tx, `project:${projectId}`, 'file')
  const ownedFiles = and(
    eq(workspaceFiles.entityType, 'project'),
    eq(workspaceFiles.entityId, projectId),
    eq(workspaceFiles.context, 'project')
  )
  const eventIds: string[] = []
  let purgedBytes = 0
  let afterId = ''
  for (;;) {
    const files = await tx
      .select({
        id: workspaceFiles.id,
        key: workspaceFiles.key,
        sizeBytes: workspaceFiles.sizeBytes,
      })
      .from(workspaceFiles)
      .where(and(ownedFiles, gt(workspaceFiles.id, afterId)))
      .orderBy(asc(workspaceFiles.id))
      .limit(PURGE_BATCH_SIZE)
      .for('update')
    if (!files.length) break
    const fileIds = files.map((file) => file.id)
    const keys = new Set(files.map((file) => file.key))
    for (const file of files) {
      if (file.sizeBytes === null || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)
        throw new Error('Project retirement requires canonical file sizes')
      purgedBytes += file.sizeBytes
      if (!Number.isSafeInteger(purgedBytes))
        throw new Error('Project retirement exceeds the safe storage range')
    }
    const versions = await tx
      .select({ key: workspaceFileVersion.key })
      .from(workspaceFileVersion)
      .where(inArray(workspaceFileVersion.fileId, fileIds))
    for (const version of versions) keys.add(version.key)
    for (const key of keys) {
      if (!key.startsWith(`project/${projectId}/`))
        throw new Error('Project retirement encountered a foreign storage key')
    }
    eventIds.push(...(await enqueueWorkspaceFileStorageCleanups(tx, [...keys], 'project')))
    await tx
      .delete(publicShare)
      .where(and(eq(publicShare.resourceType, 'file'), inArray(publicShare.resourceId, fileIds)))
    await tx.delete(workspaceFiles).where(and(ownedFiles, inArray(workspaceFiles.id, fileIds)))
    afterId = files[files.length - 1].id
  }
  if (purgedBytes !== expectedBillableBytes)
    throw new Error('Project storage changed during retirement')
  const removedFolders = await tx
    .delete(folder)
    .where(
      and(
        eq(folder.entityType, 'project'),
        eq(folder.entityId, projectId),
        eq(folder.resourceType, 'file')
      )
    )
    .returning({ id: folder.id })
  if (removedFolders.length)
    await tx.delete(publicShare).where(
      and(
        eq(publicShare.resourceType, 'folder'),
        inArray(
          publicShare.resourceId,
          removedFolders.map((row) => row.id)
        )
      )
    )
  return eventIds
}
