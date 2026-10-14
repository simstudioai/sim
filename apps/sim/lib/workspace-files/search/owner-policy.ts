import { compareStrings } from '@sim/utils/string'
import { tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'
import { lockProject } from '@/lib/projects/membership'
import {
  type FileOwnerAdapters,
  requireFileOwnerAdapter,
} from '@/lib/workspace-files/owner-adapters'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

const policies: FileOwnerAdapters<{
  lock(tx: DbTransaction, entityId: string): Promise<void>
  tryLock(tx: DbTransaction, entityId: string): Promise<boolean>
}> = {
  workspace: {
    async lock() {},
    async tryLock() {
      return true
    },
  },
  project: {
    lock: lockProject,
    tryLock: (tx, id) => tryAcquireAdvisoryXactLock(tx, 'file_search_dispatch', `project:${id}`),
  },
}

/** Background work follows application lock order without acquiring a human's authority. */
export async function lockFileSearchOwners(
  tx: DbTransaction,
  owners: readonly EditableFileOwner[],
  options: { skipBusy?: boolean } = {}
): Promise<EditableFileOwner[]> {
  const ordered = [
    ...new Map(
      owners.map((owner) => [JSON.stringify([owner.entityType, owner.entityId]), owner])
    ).values(),
  ]
  ordered.sort(
    (a, b) => compareStrings(a.entityType, b.entityType) || compareStrings(a.entityId, b.entityId)
  )
  const acquired: EditableFileOwner[] = []
  for (const owner of ordered) {
    const policy = requireFileOwnerAdapter(policies, owner)
    if (options.skipBusy) {
      if (!(await policy.tryLock(tx, owner.entityId))) continue
    } else {
      await policy.lock(tx, owner.entityId)
    }
    acquired.push(owner)
  }
  return acquired
}
