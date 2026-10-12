import { db } from '@sim/db'
import { sql } from 'drizzle-orm'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbOrTx, DbTransaction } from '@/lib/db/types'

const FOLDER_MUTATION_LOCK_TIMEOUT_MS = 5_000

/** Serializes every writer for one workspace resource-folder tree. */
export async function acquireFolderMutationLock(
  tx: DbTransaction,
  workspaceId: string,
  resourceType: FolderResourceType
): Promise<void> {
  await tx.execute(
    sql`select set_config('lock_timeout', ${`${FOLDER_MUTATION_LOCK_TIMEOUT_MS}ms`}, true)`
  )
  await acquireAdvisoryXactLock(
    tx,
    'resource_folders',
    `resource_folders:${resourceType}:${workspaceId}`
  )
}

/**
 * Keeps path resolution stable while a resource mutation commits against the
 * resolved folder. The callback may use `tx` for reads; folder writers for the
 * same workspace and resource type cannot proceed until it returns.
 */
export async function withFolderTreeLock<T>(
  workspaceId: string,
  resourceType: FolderResourceType,
  operation: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await acquireFolderMutationLock(tx, workspaceId, resourceType)
    return operation(tx)
  })
}
