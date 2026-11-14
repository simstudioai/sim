import { workspaceFiles } from '@sim/db/schema'
import { and, asc, count, inArray, not, or, type SQL } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db/types'
import { snapshotWorkspaceFileSecretProvenanceInTx } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import {
  isVersionHeadCurrent,
  loadWorkspaceFileVersionHeads,
  materializeWorkspaceFileVersionInTx,
  workspaceFileVersionHeadCurrentSql,
} from '@/lib/uploads/contexts/workspace/file-version-store'

/** Contexts whose files keep version history, frozen before their creator changes. */
const VERSIONED_FILE_CONTEXTS = ['workspace', 'project']

/**
 * Freezes implicit history under the writer lock before replacing a shared file's live creator.
 * Every statement is keyed by `condition`, never by a list of file ids: a departing member can
 * own more files than Postgres accepts bind parameters.
 */
export async function handoffFileCreatorsInTx(
  tx: DbTransaction,
  condition: SQL | undefined,
  successorId: string
) {
  if (!condition) throw new Error('File creator handoff requires a scope')
  // Takes every row lock in id order without loading the rows into memory.
  const locked = tx
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(condition)
    .orderBy(asc(workspaceFiles.id))
    .for('update')
    .as('locked')
  await tx.select({ count: count() }).from(locked)

  const isVersioned = inArray(workspaceFiles.context, VERSIONED_FILE_CONTEXTS)
  const versionedCondition = and(condition, isVersioned)
  // Also locks a versioned file committed after the lock pass before its history is frozen.
  const versioned = await tx
    .select()
    .from(workspaceFiles)
    .where(versionedCondition)
    .orderBy(asc(workspaceFiles.id))
    .for('update')
  const heads = await loadWorkspaceFileVersionHeads(
    tx.select({ id: workspaceFiles.id }).from(workspaceFiles).where(versionedCondition),
    tx
  )
  for (const file of versioned) {
    const head = heads.get(file.id)
    if (isVersionHeadCurrent(head, file)) continue
    const provenance =
      file.projectId && file.secretProvenanceVersion === null
        ? { status: 'unknown' as const, entries: [] }
        : await snapshotWorkspaceFileSecretProvenanceInTx(
            tx,
            file.id,
            file.contentUpdatedAt,
            file.secretProvenanceVersion
          )
    await materializeWorkspaceFileVersionInTx(tx, file, head, provenance, new Date())
  }

  await tx
    .update(workspaceFiles)
    .set({ userId: successorId, updatedAt: new Date() })
    .where(
      and(
        condition,
        // A versioned file committed after the history pass keeps its creator until frozen.
        or(not(isVersioned), workspaceFileVersionHeadCurrentSql())
      )
    )
}
