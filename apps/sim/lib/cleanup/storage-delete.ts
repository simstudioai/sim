import { createLogger } from '@sim/logger'
import { chunkArray } from '@sim/utils/helpers'
import { DEFAULT_DELETE_CHUNK_SIZE } from '@/lib/cleanup/batch-delete'
import { StorageService } from '@/lib/uploads'

const logger = createLogger('CleanupStorageDelete')

/**
 * Deletes workspace storage objects in provider-sized chunks and returns the keys that could not be
 * deleted, so callers keep the rows that reference them for the next run instead of orphaning the
 * objects. Missing objects count as deleted.
 */
export async function deleteWorkspaceStorageObjects(
  keys: readonly string[],
  label: string
): Promise<Set<string>> {
  const failedKeys = new Set<string>()
  for (const batch of chunkArray([...keys], DEFAULT_DELETE_CHUNK_SIZE)) {
    const deletion = await StorageService.deleteFiles(batch, 'workspace')
    for (const { key, error } of deletion.failed) {
      failedKeys.add(key)
      logger.error(`[${label}] Failed to delete storage object ${key}`, { error })
    }
  }
  return failedKeys
}
