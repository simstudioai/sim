import { peopleDirectoryEntry, peopleDirectorySync } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/** Marks the source due in the same commit as a provisioning change. A stale in-flight read cannot put a retired identity back. */
export async function markScimPeopleChanged(
  tx: DbOrTx,
  organizationId: string,
  removedIds: string[] = []
): Promise<void> {
  const [connection] = await tx
    .update(peopleDirectorySync)
    .set({
      nextSyncAt: new Date(),
    })
    .where(
      and(
        eq(peopleDirectorySync.organizationId, organizationId),
        eq(peopleDirectorySync.source, 'scim')
      )
    )
    .returning({ id: peopleDirectorySync.organizationId })
  if (connection && removedIds.length) {
    await tx
      .delete(peopleDirectoryEntry)
      .where(
        and(
          eq(peopleDirectoryEntry.organizationId, organizationId),
          inArray(peopleDirectoryEntry.externalId, removedIds)
        )
      )
  }
}
