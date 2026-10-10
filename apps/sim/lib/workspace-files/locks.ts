import type { DbTransaction } from '@/lib/db/types'
import { acquireFolderMutationLock } from '@/lib/folders/locks'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

/** Locks owner directories in a stable order after lifecycle and billing locks are held. */
export async function lockFileDirectories(
  tx: DbTransaction,
  owners: readonly EditableFileOwner[]
): Promise<void> {
  // These keys also coordinate with deployed workspace writers and folder hierarchy triggers.
  const keys = owners.map((owner) =>
    owner.entityType === 'workspace' ? owner.entityId : `project:${owner.entityId}`
  )
  for (const key of [...new Set(keys)].sort()) {
    await acquireFolderMutationLock(tx, key, 'file')
  }
}
