import { executionLargeValues, workspaceFiles } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Reference writers hold shared locks until their transaction commits. Cleanup
 * takes exclusive locks on the same rows before rechecking liveness and claiming
 * a tombstone, so a new reference either protects the object or fails explicitly.
 */
export async function lockLargeValueKeysForReference(
  tx: Pick<DbOrTx, 'select'>,
  keys: string[]
): Promise<void> {
  for (const batch of chunkArray([...new Set(keys)].sort(), 500)) {
    const values = await tx
      .select({ key: executionLargeValues.key, deletedAt: executionLargeValues.deletedAt })
      .from(executionLargeValues)
      .where(inArray(executionLargeValues.key, batch))
      .orderBy(asc(executionLargeValues.key))
      .for('share')
    const available = new Set<string>()
    for (const row of values) {
      if (row.deletedAt) throw new Error('Cannot reference a deleted large value')
      available.add(row.key)
    }
    const legacyKeys = batch.filter((key) => !available.has(key))
    if (legacyKeys.length > 0) {
      const files = await tx
        .select({ key: workspaceFiles.key, deletedAt: workspaceFiles.deletedAt })
        .from(workspaceFiles)
        .where(
          and(inArray(workspaceFiles.key, legacyKeys), eq(workspaceFiles.context, 'execution'))
        )
        .orderBy(asc(workspaceFiles.key))
        .for('share')
      for (const row of files) {
        if (row.deletedAt) throw new Error('Cannot reference a deleted large value')
        available.add(row.key)
      }
    }
    if (available.size !== batch.length) throw new Error('Cannot reference a missing large value')
  }
}
