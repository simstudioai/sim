import { workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, inArray, isNull } from 'drizzle-orm'
import type { BoundedCleanup } from '@/lib/cleanup/bounded'
import type { CleanupType } from '@/lib/cleanup/bounded-types'
import { isUsingCloudStorage, type StorageContext, StorageService } from '@/lib/uploads'

/** Storage failures stop the run; progress includes objects already removed. */
export async function deleteBoundedStorage(
  control: BoundedCleanup,
  type: CleanupType,
  keys: string[],
  context: StorageContext
) {
  if (!isUsingCloudStorage()) return
  for (const batch of chunkArray([...new Set(keys)], control.options.batchSize)) {
    let result: Awaited<ReturnType<typeof StorageService.deleteFiles>>
    try {
      result = await StorageService.deleteFiles(batch, context)
    } catch (error) {
      await control.files(type, 0, batch.length)
      throw error
    }
    await control.files(type, result.deleted, result.failed.length)
    if (result.failed.length > 0)
      throw new Error(`${type}: ${result.failed.length} storage deletions failed`)
  }
}

/** Equivalent to deleteFileMetadata, on the cleanup pool with local timeouts. */
export async function tombstoneBoundedFiles(control: BoundedCleanup, keys: string[]) {
  if (keys.length === 0) return
  for (const batch of chunkArray(keys, control.options.batchSize)) {
    await control.query(async (tx) => {
      await tx
        .update(workspaceFiles)
        .set({ deletedAt: new Date() })
        .where(and(inArray(workspaceFiles.key, batch), isNull(workspaceFiles.deletedAt)))
    })
  }
}
